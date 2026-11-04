import { test, expect, type Page } from "@playwright/test";
import { createPool } from "../../apps/api/src/db/pool.js";
test.beforeEach(async () => {
  const pool = createPool(
    "postgres://renewals:renewals_local@127.0.0.1:55433/renewals_e2e",
  );
  try {
    await pool.query("TRUNCATE renewal_history,renewal_jobs,renewals,sessions");
    await pool.query(
      "UPDATE resources SET expires_on='2027-03-01' WHERE id='res-a-01'",
    );
  } finally {
    await pool.end();
  }
});
async function login(page: Page, account: string) {
  await page.goto("/");
  await page.getByLabel("Учетная запись").selectOption(account);
  await page.getByLabel("Пароль", { exact: true }).fill("Demo-2026!");
  await page.getByRole("button", { name: "Войти в пространство" }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на продление" }),
  ).toBeVisible();
}
test("complete workflow, keyboard dialog, roles, history and mobile layout", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "initiator.alpha");
  await expect(page.getByText("res-a-01", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-workspace.png`,
    fullPage: true,
  });
  const width = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport);
  await page
    .getByRole("button", { name: "Создать заявку", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Создать заявку", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await page
    .getByRole("combobox", { name: "Ресурс", exact: true })
    .selectOption("res-a-01");
  await expect(page.getByText("31.03.2027", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Отправить на согласование" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("tab", { name: /Заявки/ }).click();
  await page.getByRole("button", { name: "Подробнее" }).first().click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("На согласовании", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Согласовать", exact: true }),
  ).not.toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await login(page, "approver.alpha");
  await expect(
    page.getByRole("button", { name: "Создать заявку", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("tab", { name: /Заявки/ }).click();
  await page.getByRole("button", { name: "Подробнее" }).first().click();
  await page.getByRole("button", { name: "Согласовать", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Завершена", { exact: true }).first(),
  ).toBeVisible({ timeout: 12000 });
  await expect(
    page.getByText("Провайдер подтвердил операцию. Срок ресурса обновлен", {
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Ресурсы/ }).click();
  await expect(page.getByText("31.03.2027", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await login(page, "initiator.beta");
  await expect(page.getByText("res-b-01", { exact: true })).toBeVisible();
  await expect(page.getByText("res-a-01", { exact: true })).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("own decisions are hidden and another approver can reject without changing the resource", async ({
  page,
}) => {
  await login(page, "universal.alpha");
  await page
    .getByRole("button", { name: "Создать заявку", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Ресурс", exact: true })
    .selectOption("res-a-02");
  await page.getByRole("button", { name: "Отправить на согласование" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("tab", { name: /Заявки/ }).click();
  await page.getByRole("button", { name: "Подробнее" }).click();
  await expect(
    page.getByText("Собственную заявку должен рассмотреть другой согласующий."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Согласовать", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Отклонить", exact: true }),
  ).not.toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await login(page, "approver.alpha");
  await page.getByRole("tab", { name: /Заявки/ }).click();
  await page.getByRole("button", { name: "Подробнее" }).click();
  await page.getByRole("button", { name: "Отклонить", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Отклонена", { exact: true }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Ресурсы/ }).click();
  await expect(page.getByText("20.05.2027", { exact: true })).toBeVisible();
});

test("loading, empty requests, keyboard tabs and a readable API conflict", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/resources", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await login(page, "initiator.alpha");
    await expect(page.getByRole("status")).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByText("res-a-01", { exact: true })).toBeVisible();
  await page.unroute("**/api/resources");
  await page.getByRole("tab", { name: /Ресурсы/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Заявки/ })).toBeFocused();
  await expect(
    page.getByText("Заявок пока нет", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/renewals", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 409,
        json: { message: "Для ресурса уже существует активная заявка" },
      });
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Создать заявку", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Ресурс", exact: true })
    .selectOption("res-a-01");
  await page.getByRole("button", { name: "Отправить на согласование" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Для ресурса уже существует активная заявка",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
});
