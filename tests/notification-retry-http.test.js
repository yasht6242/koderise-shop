import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  handleAdminNotificationRetry,
  handleInternalNotificationRetry,
} from "../app/services/notification-retry-http.server.js";

const secret = "phase4-test-secret";

function retryResult(overrides = {}) {
  return {
    retried: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    email: "buyer@example.com",
    ...overrides,
  };
}

function internalRequest(method, token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return new Request("https://example.com/internal/notification-retries", {
    method,
    headers,
  });
}

describe("internal notification retry authorization", () => {
  it("rejects a missing secret and does not run retries", async () => {
    let ran = false;
    const response = await handleInternalNotificationRetry({
      request: internalRequest("POST", secret),
      expectedSecret: "",
      runRetry: async () => {
        ran = true;
        return retryResult();
      },
    });

    assert.equal(ran, false);
    assert.equal(response.status, 401);
  });

  it("rejects a missing or wrong bearer token", async () => {
    let ran = false;
    const missing = await handleInternalNotificationRetry({
      request: internalRequest("POST"),
      expectedSecret: secret,
      runRetry: async () => {
        ran = true;
        return retryResult();
      },
    });
    const wrong = await handleInternalNotificationRetry({
      request: internalRequest("POST", "wrong-token"),
      expectedSecret: secret,
      runRetry: async () => {
        ran = true;
        return retryResult();
      },
    });

    assert.equal(ran, false);
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
  });

  it("rejects non-POST methods", async () => {
    let ran = false;
    const response = await handleInternalNotificationRetry({
      request: internalRequest("GET", secret),
      expectedSecret: secret,
      runRetry: async () => {
        ran = true;
        return retryResult();
      },
    });

    assert.equal(ran, false);
    assert.equal(response.status, 405);
  });

  it("returns only aggregate counts for an authorized POST", async () => {
    const response = await handleInternalNotificationRetry({
      request: internalRequest("POST", secret),
      expectedSecret: secret,
      runRetry: async () =>
        retryResult({ retried: 2, sent: 1, failed: 1, skipped: 3 }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      success: true,
      retried: 2,
      sent: 1,
      failed: 1,
      skipped: 3,
    });
  });
});

describe("admin notification retry route", () => {
  it("does not run retries when admin authentication fails", async () => {
    let ran = false;
    const response = await handleAdminNotificationRetry({
      request: new Request("https://example.com/app/retry-notifications", {
        method: "POST",
      }),
      authenticateAdmin: async () => {
        throw new Error("Unauthorized");
      },
      runRetry: async () => {
        ran = true;
        return retryResult({ sent: 1 });
      },
    });

    assert.equal(ran, false);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.email, undefined);
  });

  it("runs retries only after admin authentication succeeds", async () => {
    const calls = [];
    const response = await handleAdminNotificationRetry({
      request: new Request("https://example.com/app/retry-notifications", {
        method: "POST",
      }),
      authenticateAdmin: async () => {
        calls.push("auth");
      },
      runRetry: async () => {
        calls.push("retry");
        return retryResult({ retried: 1, sent: 1 });
      },
    });
    const body = await response.json();

    assert.deepEqual(calls, ["auth", "retry"]);
    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      success: true,
      retried: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
    });
  });
});
