import { expect, test } from "@playwright/test";

test("current public facts supersede historical intake exclusions without rewriting the audit notes", async ({
  page,
}) => {
  const oldExclusion =
    "Public artifacts contain no owner names or postal/contact values.";
  const sourceLimitation =
    "Issued observations do not establish open or completed work.";
  await page.route("**/api/coverage", async (route) => {
    await route.fulfill({
      json: [
        {
          source: "Recorded V9 source intake",
          scope: "Historical source observation",
          state: "partial",
          count: 7500,
          limitations: [oldExclusion, sourceLimitation],
        },
      ],
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Current eligible public projection",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /current public snapshot includes admitted official raw fields/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Their exclusions for official owner, postal, Applicant and raw source fields are superseded/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /No qualified source-confirmed open or continuously long-open permit cohort was found/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Qualified current-PIN deed-index gaps do not establish continuous legal ownership/,
    ),
  ).toBeVisible();

  const historical = page.locator("details.historical-coverage");
  await expect(historical).toHaveJSProperty("open", false);
  await expect(page.getByText(oldExclusion, { exact: true })).not.toBeVisible();
  await historical.locator("summary").click();
  await expect(historical).toHaveJSProperty("open", true);
  await expect(page.getByText(oldExclusion, { exact: true })).toBeVisible();
  await expect(page.getByText(sourceLimitation, { exact: true })).toBeVisible();
  await historical.locator("summary").click();
  await expect(page.getByText(oldExclusion, { exact: true })).not.toBeVisible();
});
