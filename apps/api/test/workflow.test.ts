import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createServer } from "node:http";
import EmbeddedPostgres from "embedded-postgres";
import { createPool } from "../src/db/pool.js";
import { migrate, seed } from "../src/db/setup.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { Worker } from "../src/modules/worker/worker.js";
import {
  ProviderClient,
  type Provider,
  type ProviderResult,
} from "../src/modules/provider/client.js";
import type { RenewalDetail, User } from "@renewals/contracts";
const url = "postgres://renewals:renewals_local@127.0.0.1:55432/renewals_test";
const db = new EmbeddedPostgres({
  databaseDir: resolve(`.data/test-${randomUUID()}`),
  user: "renewals",
  password: "renewals_local",
  port: 55432,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
const pool = createPool(url);
const settings = {
  ...config,
  databaseUrl: url,
  providerUrl: "http://127.0.0.1:18091",
  retryDelayMs: 150,
  pollMs: 25,
};
let app: Awaited<ReturnType<typeof createApp>>;
let simulator: ChildProcess;
const children = new Set<ChildProcess>();
const tokens: Record<string, string> = {};
let loginSequence = 0;
async function until(check: () => Promise<boolean>, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("Timed out waiting for observable state");
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>((r) => {
    child.once("exit", () => r());
    child.kill("SIGKILL");
  });
  children.delete(child);
}
function launchApi() {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/api/src/main.ts"],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        PORT: "13001",
        PROVIDER_URL: settings.providerUrl,
        RETRY_DELAY_MS: "600",
        WORKER_POLL_MS: "25",
        WORKER_ENABLED: "true",
      },
      stdio: "ignore",
    },
  );
  children.add(child);
  return child;
}
const call = (
  method: "GET" | "POST",
  path: string,
  who?: string,
  body?: object,
) =>
  app.inject({
    method,
    url: `/api${path}`,
    headers: who ? { cookie: tokens[who]! } : {},
    ...(body ? { payload: body } : {}),
  });
async function create(resource = "res-a-01", who = "initiator.alpha") {
  const res = await call("POST", "/renewals", who, { resource_id: resource });
  assert.equal(res.statusCode, 201, res.body);
  return res.json<RenewalDetail>();
}
async function approve(id: string) {
  const res = await call("POST", `/renewals/${id}/approve`, "approver.alpha");
  assert.equal(res.statusCode, 200, res.body);
}
async function due(id: string) {
  await pool.query(
    "UPDATE renewal_jobs SET next_attempt_at=now() WHERE renewal_id=$1",
    [id],
  );
}
async function detail(id: string) {
  return (
    await call("GET", `/renewals/${id}`, "initiator.alpha")
  ).json<RenewalDetail>();
}
before(async () => {
  await db.initialise();
  await db.start();
  await db.createDatabase("renewals_test");
  await migrate(pool);
  await seed(pool);
  app = await createApp(pool, settings);
  simulator = spawn(
    "python",
    [
      "-c",
      "import runpy; m=runpy.run_path('provider_simulator.py'); m['ThreadingHTTPServer'](('127.0.0.1',18091),m['Handler']).serve_forever()",
    ],
    { stdio: "ignore" },
  );
  children.add(simulator);
  await until(async () => (await fetch(`${settings.providerUrl}/health`)).ok);
});
beforeEach(async () => {
  await pool.query("TRUNCATE renewal_history,renewal_jobs,renewals,sessions");
  await pool.query(
    "UPDATE resources SET expires_on=CASE id WHEN 'res-a-01' THEN DATE '2027-03-01' WHEN 'res-a-02' THEN DATE '2027-05-20' ELSE DATE '2027-06-01' END,amount_minor=CASE id WHEN 'res-a-01' THEN 128000 WHEN 'res-a-02' THEN 250000 ELSE 150000 END",
  );
  for (const login of [
    "initiator.alpha",
    "approver.alpha",
    "universal.alpha",
    "initiator.beta",
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: `127.0.0.${++loginSequence}`,
      payload: { login, password: "Demo-2026!" },
    });
    assert.equal(response.statusCode, 200, response.body);
    tokens[login] = response.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }
});
after(async () => {
  for (const child of children) await stop(child);
  await app?.close();
  await pool.end();
  await db.stop();
});
test("401 for missing/invalid session; login rejects role injection, wrong password and cross-origin mutations", async () => {
  assert.equal((await call("GET", "/resources")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/api/resources",
        headers: { cookie: "session=bogus" },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { login: "initiator.alpha", password: "wrong" },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          login: "initiator.alpha",
          password: "Demo-2026!",
          can_approve: true,
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/renewals",
        headers: {
          cookie: tokens["initiator.alpha"]!,
          origin: "https://invalid.example",
        },
        payload: { resource_id: "res-a-01" },
      })
    ).statusCode,
    403,
  );
});
test("known IDs and list filtering do not cross workspace boundaries", async () => {
  const row = await create();
  assert.equal(
    (await call("GET", "/resources/res-a-01", "initiator.beta")).statusCode,
    403,
  );
  assert.equal(
    (await call("GET", `/renewals/${row.id}`, "initiator.beta")).statusCode,
    403,
  );
  assert.equal(
    (await call("GET", "/renewals?resource_id=res-a-01", "initiator.beta"))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await call("POST", "/renewals", "initiator.beta", {
        resource_id: "res-a-01",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call("POST", `/renewals/${row.id}/approve`, "initiator.beta"))
      .statusCode,
    403,
  );
  assert.deepEqual(
    (await call("GET", "/renewals", "initiator.beta")).json(),
    [],
  );
  assert.equal(
    (await call("GET", "/resources", "initiator.beta")).json().length,
    1,
  );
});
test("rights and author identity are server-controlled; both own decisions are forbidden", async () => {
  assert.equal(
    (
      await call("POST", "/renewals", "approver.alpha", {
        resource_id: "res-a-01",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call("POST", "/renewals", "initiator.alpha", {
        resource_id: "res-a-01",
        created_by: randomUUID(),
      })
    ).statusCode,
    400,
  );
  const row = await create("res-a-01", "universal.alpha");
  for (const action of ["approve", "reject"])
    assert.equal(
      (await call("POST", `/renewals/${row.id}/${action}`, "universal.alpha"))
        .statusCode,
      403,
    );
  assert.equal(
    (await call("POST", `/renewals/${row.id}/approve`, "initiator.alpha"))
      .statusCode,
    403,
  );
  const user = (await call("GET", "/auth/me", "universal.alpha")).json<User>();
  assert.equal(row.created_by, user.id);
});
test("parallel creation is protected by partial unique DB index, including direct SQL", async () => {
  const results = await Promise.all([
    call("POST", "/renewals", "initiator.alpha", { resource_id: "res-a-01" }),
    call("POST", "/renewals", "initiator.alpha", { resource_id: "res-a-01" }),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
  const row = results.find((r) => r.statusCode === 201)!.json<RenewalDetail>();
  assert.equal(row.old_expires_on, "2027-03-01");
  assert.equal(row.new_expires_on, "2027-03-31");
  assert.equal(row.amount_minor, 128000);
  await assert.rejects(
    pool.query(
      `INSERT INTO renewals(id,resource_id,workspace_id,created_by,old_expires_on,new_expires_on,amount_minor,currency,operation_key) SELECT $1,resource_id,workspace_id,created_by,old_expires_on,new_expires_on,amount_minor,currency,$2 FROM renewals WHERE id=$3`,
      [randomUUID(), randomUUID(), row.id],
    ),
    (error: unknown) => (error as { code: string }).code === "23505",
  );
});
test("parallel approval has one winner, one job and one approval event; repeated transitions return 409", async () => {
  const row = await create();
  const results = await Promise.all([
    call("POST", `/renewals/${row.id}/approve`, "approver.alpha"),
    call("POST", `/renewals/${row.id}/approve`, "approver.alpha"),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal((await pool.query("SELECT * FROM renewal_jobs")).rowCount, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM renewal_history WHERE to_status='processing'",
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (await call("POST", `/renewals/${row.id}/reject`, "approver.alpha"))
      .statusCode,
    409,
  );
});
test("stale date or amount prevents approval without creating a job", async () => {
  const row = await create();
  for (const update of [
    "expires_on=expires_on+1",
    "amount_minor=amount_minor+1",
  ]) {
    await pool.query(`UPDATE resources SET ${update} WHERE id='res-a-01'`);
    assert.equal(
      (await call("POST", `/renewals/${row.id}/approve`, "approver.alpha"))
        .statusCode,
      409,
    );
  }
  assert.equal((await pool.query("SELECT * FROM renewal_jobs")).rowCount, 0);
  assert.equal((await detail(row.id)).status, "pending");
});
test("rejection never calls provider, preserves expiry and allows a new request", async () => {
  const row = await create("res-a-02");
  assert.equal(
    (await call("POST", `/renewals/${row.id}/reject`, "approver.alpha"))
      .statusCode,
    200,
  );
  assert.equal(
    (await call("POST", `/renewals/${row.id}/approve`, "approver.alpha"))
      .statusCode,
    409,
  );
  const worker = new Worker(
    pool,
    new ProviderClient(settings.providerUrl, 1000),
    150,
    25,
  );
  await worker.tick();
  assert.equal(
    (await pool.query("SELECT expires_on FROM resources WHERE id='res-a-02'"))
      .rows[0].expires_on,
    "2027-05-20",
  );
  assert.equal(
    (
      (await (
        await fetch(`${settings.providerUrl}/stats?resource_id=res-a-02`)
      ).json()) as { operation_count: number }
    ).operation_count,
    0,
  );
  await create("res-a-02");
});
test("hard process crash after 503 recovers via same key; provider and local date change exactly once", async () => {
  const row = await create();
  await approve(row.id);
  const first = launchApi();
  await until(async () => {
    const d = await detail(row.id);
    return d.history.some((h) =>
      h.message.startsWith("Подтверждение не получено"),
    );
  });
  await stop(first);
  assert.equal((await detail(row.id)).status, "processing");
  const recovered = launchApi();
  await until(async () => (await detail(row.id)).status === "completed");
  await stop(recovered);
  const finished = await detail(row.id);
  assert.equal(finished.operation_key, row.operation_key);
  assert.equal(finished.post_attempts, 1);
  assert.equal(
    (await pool.query("SELECT expires_on FROM resources WHERE id='res-a-01'"))
      .rows[0].expires_on,
    "2027-03-31",
  );
  const result = (await (
    await fetch(
      `${settings.providerUrl}/renewals/${encodeURIComponent(row.operation_key)}`,
    )
  ).json()) as ProviderResult;
  assert.equal(result.started_count, 1);
  assert.equal(result.operation_id, finished.provider_operation_id);
  assert.equal(
    (
      (await (
        await fetch(`${settings.providerUrl}/stats?resource_id=res-a-01`)
      ).json()) as { operation_count: number }
    ).operation_count,
    1,
  );
  const worker = new Worker(
    pool,
    new ProviderClient(settings.providerUrl, 1000),
    150,
    25,
  );
  await Promise.all([worker.tick(), worker.tick()]);
  await worker.process(row.id);
  assert.equal(
    (await pool.query("SELECT expires_on FROM resources WHERE id='res-a-01'"))
      .rows[0].expires_on,
    "2027-03-31",
  );
  assert.equal(
    finished.history.filter((h) => h.to_status === "completed").length,
    1,
  );
  await create();
});
test("third uncertain POST is reconciled by GET before attention; no fourth POST", async () => {
  const row = await create();
  await approve(row.id);
  let sends = 0,
    gets = 0;
  const provider: Provider = {
    send: async () => {
      sends++;
      return null;
    },
    lookup: async () => {
      gets++;
      return null;
    },
  };
  const worker = new Worker(pool, provider, 150, 25);
  for (let i = 0; i < 4; i++) {
    await due(row.id);
    await worker.tick();
  }
  assert.equal(sends, 3);
  assert.equal(gets, 3);
  const attention = await detail(row.id);
  assert.equal(attention.status, "attention");
  assert.equal(attention.post_attempts, 3);
  assert.equal(
    (
      await call("POST", "/renewals", "initiator.alpha", {
        resource_id: "res-a-01",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await call("POST", `/renewals/${row.id}/retry`, "initiator.alpha"))
      .statusCode,
    403,
  );
  assert.equal(
    (await call("POST", `/renewals/${row.id}/retry`, "approver.alpha"))
      .statusCode,
    200,
  );
  const real = new Worker(
    pool,
    new ProviderClient(settings.providerUrl, 1000),
    150,
    25,
  );
  await real.tick();
  await due(row.id);
  await real.tick();
  const completed = await detail(row.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.operation_key, row.operation_key);
  assert.equal(completed.post_attempts, 4);
});
test("duplicate workers serialize HTTP handling using DB advisory locks", async () => {
  const row = await create();
  await approve(row.id);
  let sends = 0;
  const provider: Provider = {
    lookup: async () => null,
    send: async () => {
      sends++;
      await new Promise((r) => setTimeout(r, 70));
      return null;
    },
  };
  const a = new Worker(pool, provider, 150, 25),
    b = new Worker(pool, provider, 150, 25);
  await Promise.all([a.tick(), b.tick()]);
  assert.equal(sends, 1);
  assert.equal((await detail(row.id)).post_attempts, 1);
});
test("POST timeout/offline provider consumes exactly three attempts and releases no active-resource lock", async () => {
  const row = await create();
  await approve(row.id);
  const worker = new Worker(
    pool,
    new ProviderClient("http://127.0.0.1:1", 50),
    150,
    25,
  );
  for (let i = 0; i < 4; i++) {
    await due(row.id);
    await worker.tick();
  }
  assert.equal((await detail(row.id)).status, "attention");
  assert.equal((await detail(row.id)).post_attempts, 3);
  assert.equal(
    (await pool.query("SELECT expires_on FROM resources WHERE id='res-a-01'"))
      .rows[0].expires_on,
    "2027-03-01",
  );
});
test("an approver can retry their own request approved by someone else without replacing the approver", async () => {
  const row = await create("res-a-01", "universal.alpha");
  await approve(row.id);
  const approved = (await detail(row.id)).approved_by;
  const worker = new Worker(
    pool,
    { lookup: () => Promise.resolve(null), send: () => Promise.resolve(null) },
    150,
    25,
  );
  for (let i = 0; i < 4; i++) {
    await due(row.id);
    await worker.tick();
  }
  assert.equal((await detail(row.id)).status, "attention");
  assert.equal(
    (await call("POST", `/renewals/${row.id}/retry`, "universal.alpha"))
      .statusCode,
    200,
  );
  assert.equal((await detail(row.id)).approved_by, approved);
  assert.equal((await detail(row.id)).operation_key, row.operation_key);
});

test("logout revokes server-side session", async () => {
  assert.equal(
    (await call("POST", "/auth/logout", "initiator.alpha")).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", "/resources", "initiator.alpha")).statusCode,
    401,
  );
});

test("approval rolls back completely when durable enqueue fails", async () => {
  const row = await create();
  await pool.query(
    "CREATE FUNCTION fail_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test enqueue failure'; END $$; CREATE TRIGGER fail_enqueue BEFORE INSERT ON renewal_jobs FOR EACH ROW EXECUTE FUNCTION fail_enqueue()",
  );
  try {
    assert.equal(
      (await call("POST", `/renewals/${row.id}/approve`, "approver.alpha"))
        .statusCode,
      500,
    );
    const unchanged = await detail(row.id);
    assert.equal(unchanged.status, "pending");
    assert.equal(unchanged.approved_by, null);
    assert.equal(unchanged.history.length, 1);
    assert.equal((await pool.query("SELECT * FROM renewal_jobs")).rowCount, 0);
  } finally {
    await pool.query(
      "DROP TRIGGER fail_enqueue ON renewal_jobs; DROP FUNCTION fail_enqueue()",
    );
  }
});

test("confirmation after the third POST completes instead of attention without a fourth POST", async () => {
  const row = await create();
  await approve(row.id);
  let sends = 0;
  const provider: Provider = {
    send: async () => {
      sends++;
      return null;
    },
    lookup: async () =>
      sends === 3
        ? {
            operation_id: randomUUID(),
            status: "completed",
            started_count: 1,
            resource_id: row.resource_id,
            period_months: 1,
            amount_minor: row.amount_minor,
            currency: "RUB",
          }
        : null,
  };
  const worker = new Worker(pool, provider, 150, 25);
  for (let i = 0; i < 4; i++) {
    await due(row.id);
    await worker.tick();
  }
  assert.equal(sends, 3);
  assert.equal((await detail(row.id)).status, "completed");
});

test("database failure after provider confirmation rolls back all local results and recovers", async () => {
  const row = await create();
  await approve(row.id);
  const worker = new Worker(
    pool,
    new ProviderClient(settings.providerUrl, 1000),
    150,
    25,
  );
  await worker.tick();
  await due(row.id);
  await pool.query(
    "CREATE FUNCTION fail_expiry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test local commit failure'; END $$; CREATE TRIGGER fail_expiry BEFORE UPDATE ON resources FOR EACH ROW EXECUTE FUNCTION fail_expiry()",
  );
  try {
    await assert.rejects(worker.tick());
    const unchanged = await detail(row.id);
    assert.equal(unchanged.status, "processing");
    assert.equal(unchanged.provider_operation_id, null);
    assert.equal(
      (
        await pool.query("SELECT done FROM renewal_jobs WHERE renewal_id=$1", [
          row.id,
        ])
      ).rows[0].done,
      false,
    );
    assert.equal(
      (
        await pool.query("SELECT expires_on FROM resources WHERE id=$1", [
          row.resource_id,
        ])
      ).rows[0].expires_on,
      "2027-03-01",
    );
  } finally {
    await pool.query(
      "DROP TRIGGER fail_expiry ON resources; DROP FUNCTION fail_expiry()",
    );
  }
  await worker.tick();
  const completed = await detail(row.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.post_attempts, 1);
  assert.equal(
    completed.history.filter((h) => h.to_status === "completed").length,
    1,
  );
});

test("mismatched provider response never changes expiry; all retries retain identical key and payload", async () => {
  const row = await create();
  await approve(row.id);
  const sent: { key: string | undefined; body: string }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    if (req.method === "POST")
      sent.push({
        key: req.headers["idempotency-key"] as string | undefined,
        body,
      });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        operation_id: randomUUID(),
        status: "completed",
        started_count: 1,
        resource_id: row.resource_id,
        period_months: 1,
        amount_minor: row.amount_minor + 1,
        currency: "RUB",
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const worker = new Worker(
      pool,
      new ProviderClient(`http://127.0.0.1:${address.port}`, 1000),
      150,
      25,
    );
    for (let i = 0; i < 4; i++) {
      await due(row.id);
      await worker.tick();
    }
    assert.equal((await detail(row.id)).status, "attention");
    assert.equal(sent.length, 3);
    assert.ok(
      sent.every(
        (request) =>
          request.key === row.operation_key && request.body === sent[0]!.body,
      ),
    );
    assert.deepEqual(JSON.parse(sent[0]!.body), {
      resource_id: row.resource_id,
      period_months: 1,
      amount_minor: 128000,
      currency: "RUB",
    });
    assert.equal(
      (
        await pool.query("SELECT expires_on FROM resources WHERE id=$1", [
          row.resource_id,
        ])
      ).rows[0].expires_on,
      "2027-03-01",
    );
  } finally {
    await new Promise<void>((r, error) =>
      server.close((e) => (e ? error(e) : r())),
    );
  }
});

test("creation racing approval and completion has no lock inversion or inconsistent snapshot", async () => {
  for (let i = 0; i < 5; i++) {
    const row = await create();
    const [approval, duplicate] = await Promise.all([
      call("POST", `/renewals/${row.id}/approve`, "approver.alpha"),
      call("POST", "/renewals", "initiator.alpha", { resource_id: "res-a-01" }),
    ]);
    assert.equal(approval.statusCode, 200, approval.body);
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    const result: ProviderResult = {
      operation_id: randomUUID(),
      status: "completed",
      started_count: 1,
      resource_id: row.resource_id,
      period_months: 1,
      amount_minor: row.amount_minor,
      currency: "RUB",
    };
    const worker = new Worker(
      pool,
      { send: async () => result, lookup: async () => result },
      150,
      25,
    );
    const [, next] = await Promise.all([
      worker.tick(),
      call("POST", "/renewals", "initiator.alpha", { resource_id: "res-a-01" }),
    ]);
    assert.ok([201, 409].includes(next.statusCode), next.body);
    if (next.statusCode === 201)
      assert.equal(
        next.json<RenewalDetail>().old_expires_on,
        row.new_expires_on,
      );
    assert.equal((await detail(row.id)).status, "completed");
    await pool.query("TRUNCATE renewal_history,renewal_jobs,renewals");
    await pool.query(
      "UPDATE resources SET expires_on='2027-03-01' WHERE id='res-a-01'",
    );
  }
});
