"use strict";

// Stub-SDK tests for frontend/js/auth.js. No network, no real Cognito.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const AUTH_PATH = path.join(__dirname, "..", "frontend", "js", "auth.js");
const AUTH_SOURCE = fs.readFileSync(AUTH_PATH, "utf8");
const CLIENT_ID = "testclient";
const PREFIX = `CognitoIdentityServiceProvider.${CLIENT_ID}.`;

function makeStorage(options) {
  options = options || {};
  const data = new Map();

  return {
    get length() {
      return data.size;
    },
    key(index) {
      const keys = Array.from(data.keys());
      return index < keys.length ? keys[index] : null;
    },
    getItem(key) {
      key = String(key);
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      key = String(key);
      if (options.failKeys && options.failKeys.has(key)) {
        throw new Error("QuotaExceededError");
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
    clear() {
      data.clear();
    },
    dump() {
      return Object.fromEntries(data);
    },
  };
}

function makeSession(username) {
  const expires = Math.floor(Date.now() / 1000) + 3600;

  return {
    getAccessToken() {
      return {
        getJwtToken() {
          return `access-token-${username}`;
        },
        getExpiration() {
          return expires;
        },
      };
    },
    getIdToken() {
      return { getJwtToken: () => "" };
    },
    getRefreshToken() {
      return { getToken: () => `refresh-token-${username}` };
    },
  };
}

// Mirrors the parts of amazon-cognito-identity-js 6.3.22 this code relies on.
// Like the real SDK, a CognitoUser without Storage defaults to localStorage.
function installSdk(window) {
  const created = [];
  const sdk = {};

  sdk.AuthenticationDetails = function (details) {
    this.getUsername = () => details.Username;
    this.getPassword = () => details.Password;
  };

  sdk.CognitoUserPool = function (config) {
    this.storage = config.Storage || window.localStorage;
    this.getClientId = () => config.ClientId;
    this.getUserPoolId = () => config.UserPoolId;
    this.getUserPoolName = () => config.UserPoolId.split("_")[1];
  };

  sdk.CognitoUser = function (data) {
    this.username = data.Username;
    this.pool = data.Pool;
    this.storage = data.Storage || window.localStorage;
    this.Session = null;
    this.completeCalls = [];
    created.push(this);
  };

  sdk.CognitoUser.prototype.cacheTokens = function (session) {
    const prefix = `CognitoIdentityServiceProvider.${this.pool.getClientId()}.${this.username}`;
    this.storage.setItem(`${prefix}.idToken`, session.getIdToken().getJwtToken());
    this.storage.setItem(`${prefix}.accessToken`, session.getAccessToken().getJwtToken());
    this.storage.setItem(`${prefix}.refreshToken`, session.getRefreshToken().getToken());
    this.storage.setItem(`${prefix}.clockDrift`, "0");
    this.storage.setItem(
      `CognitoIdentityServiceProvider.${this.pool.getClientId()}.LastAuthUser`,
      this.username
    );
  };

  sdk.CognitoUser.prototype.authenticateUser = function (details, callbacks) {
    const password = details.getPassword();
    this.lastPassword = password;

    if (password === "needs-new-password") {
      this.Session = "challenge-session";
      callbacks.newPasswordRequired({ email: "admin@example.com" }, ["email"]);
      return;
    }

    if (password === "unsupported") {
      this.Session = "mfa-session";
      callbacks.mfaRequired("SMS_MFA", {});
      return;
    }

    if (password === "slow") {
      window.__pendingAuth = { user: this, callbacks, session: makeSession(this.username) };
      return;
    }

    const session = makeSession(this.username);
    this.cacheTokens(session);
    callbacks.onSuccess(session);
  };

  sdk.CognitoUser.prototype.completeNewPasswordChallenge = function (
    newPassword,
    attributes,
    callbacks
  ) {
    this.completeCalls.push({
      user: this,
      newPassword,
      attributes,
      session: this.Session,
    });

    if (newPassword === "fail-policy") {
      const err = new Error("Password does not meet policy.");
      err.code = "InvalidPasswordException";
      callbacks.onFailure(err);
      return;
    }

    if (newPassword === "rechallenge") {
      this.Session = "second-challenge-session";
      callbacks.newPasswordRequired({ email: "admin@example.com" }, ["email"]);
      return;
    }

    if (newPassword === "throw") {
      throw new Error("boom");
    }

    if (newPassword === "slow-complete" || newPassword === "slow-fail") {
      window.__pendingComplete = {
        user: this,
        callbacks,
        session: makeSession(this.username),
      };
      return;
    }

    const session = makeSession(this.username);
    this.cacheTokens(session);
    callbacks.onSuccess(session);
  };

  window.AmazonCognitoIdentity = sdk;
  return { sdk, created };
}

function createEnv(options) {
  options = options || {};

  const sessionStorage = makeStorage(options.sessionStorage);
  const localStorage = makeStorage(options.localStorage);
  const window = {
    sessionStorage,
    localStorage,
    SARI: {},
    SARI_CONFIG: {
      useMockData: false,
      auth: {
        userPoolId: "ap-northeast-1_test",
        clientId: CLIENT_ID,
        domain: "https://test.auth.ap-northeast-1.amazoncognito.com",
        redirectUri: "http://localhost/admin.html",
        logoutUri: "http://localhost/index.html",
      },
    },
    location: {
      assign(url) {
        window.__navigatedTo = url;
      },
    },
  };

  const { created } = installSdk(window);

  const sandbox = {
    window,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Promise,
    JSON,
    decodeURIComponent,
    atob,
    btoa,
    fetch() {
      return Promise.reject(new Error("network disabled in tests"));
    },
    console,
  };

  vm.runInNewContext(AUTH_SOURCE, sandbox, { filename: AUTH_PATH });

  return {
    window,
    auth: window.SARI.auth,
    created,
    sessionStorage,
    localStorage,
  };
}

function sdkKeys(storage) {
  return Object.keys(storage.dump())
    .filter((key) => key.startsWith(PREFIX))
    .sort();
}

test("signIn keeps tokens in sessionStorage and clears the SDK cache", async () => {
  const env = createEnv();

  const result = await env.auth.signIn("admin", "correct");

  assert.equal(result.status, "signed-in");
  assert.equal(result.signedIn, true);
  assert.equal(env.created.length, 1);
  assert.equal(
    env.created[0].storage,
    env.sessionStorage,
    "CognitoUser must be given sessionStorage"
  );

  const tokens = JSON.parse(env.sessionStorage.getItem("sari.auth.tokens"));
  assert.equal(tokens.accessToken, "access-token-admin");
  assert.equal(tokens.refreshToken, "refresh-token-admin");
  assert.deepEqual(sdkKeys(env.localStorage), []);
  assert.deepEqual(sdkKeys(env.sessionStorage), []);
});

test("signOut clears SARI tokens and SDK keys from both stores", async () => {
  const env = createEnv();
  await env.auth.signIn("admin", "correct");

  env.sessionStorage.setItem(PREFIX + "leftover.accessToken", "session-leftover");
  env.localStorage.setItem(PREFIX + "admin.accessToken", "local-leftover");
  env.localStorage.setItem(PREFIX + "LastAuthUser", "admin");

  env.auth.signOut();

  assert.equal(env.sessionStorage.getItem("sari.auth.tokens"), null);
  assert.deepEqual(sdkKeys(env.sessionStorage), []);
  assert.deepEqual(sdkKeys(env.localStorage), []);
  assert.match(env.window.__navigatedTo, /\/logout\?/);
  assert.match(env.window.__navigatedTo, /client_id=testclient/);
});

test("NEW_PASSWORD_REQUIRED keeps the same user and stores no password", async () => {
  const env = createEnv();

  const challenge = await env.auth.signIn("first-timer", "needs-new-password");

  assert.equal(challenge.status, "challenge");
  assert.equal(challenge.challenge, "NEW_PASSWORD_REQUIRED");
  assert.deepEqual(challenge.requiredAttributes, ["email"]);
  assert.equal(env.created.length, 1);

  const user = env.created[0];
  assert.equal(user.Session, "challenge-session");
  assert.equal(typeof env.auth.completeNewPassword, "function");

  const done = await env.auth.completeNewPassword("N3w-Password!", {
    email: "admin@example.com",
  });

  assert.equal(done.status, "signed-in");
  assert.equal(done.signedIn, true);
  assert.equal(user.completeCalls.length, 1);
  assert.equal(user.completeCalls[0].user, user);
  assert.equal(user.completeCalls[0].session, "challenge-session");
  assert.equal(env.created.length, 1, "completion must reuse the sign-in user");

  const stored = JSON.stringify([env.sessionStorage.dump(), env.localStorage.dump()]);
  assert.equal(stored.includes("N3w-Password!"), false);
  assert.equal(stored.includes("needs-new-password"), false);

  assert.deepEqual(sdkKeys(env.sessionStorage), []);
  assert.deepEqual(sdkKeys(env.localStorage), []);
  assert.equal(
    JSON.parse(env.sessionStorage.getItem("sari.auth.tokens")).accessToken,
    "access-token-first-timer"
  );
});

test("a failed password change clears the pending challenge", async () => {
  const env = createEnv();
  await env.auth.signIn("first-timer", "needs-new-password");

  await assert.rejects(
    env.auth.completeNewPassword("fail-policy", {}),
    /policy|password/i
  );
  await assert.rejects(
    env.auth.completeNewPassword("Another-Pass1!", {}),
    /no password change is in progress/i
  );
});

test("a late onSuccess after signOut writes nothing", async () => {
  const env = createEnv();

  const pending = env.auth.signIn("slow-user", "slow");
  const slow = env.window.__pendingAuth;
  assert.ok(slow, "stub should hold the slow sign-in");

  env.auth.signOut();

  // The real SDK caches tokens before it calls onSuccess.
  slow.user.cacheTokens(slow.session);
  slow.callbacks.onSuccess(slow.session);

  const result = await pending;

  assert.equal(result.signedIn, false);
  assert.equal(env.sessionStorage.getItem("sari.auth.tokens"), null);
  assert.deepEqual(sdkKeys(env.sessionStorage), []);
  assert.deepEqual(sdkKeys(env.localStorage), []);
  assert.equal(env.auth.isSignedIn(), false);
});

test("an older sign-in cannot overwrite a newer one", async () => {
  const env = createEnv();

  const first = env.auth.signIn("alice", "slow");
  const stale = env.window.__pendingAuth;

  const second = await env.auth.signIn("bob", "correct");
  assert.equal(second.status, "signed-in");

  stale.user.cacheTokens(stale.session);
  stale.callbacks.onSuccess(stale.session);

  const firstResult = await first;
  assert.equal(firstResult.signedIn, false);

  const tokens = JSON.parse(env.sessionStorage.getItem("sari.auth.tokens"));
  assert.equal(tokens.accessToken, "access-token-bob");
  assert.equal(tokens.refreshToken, "refresh-token-bob");
  assert.deepEqual(sdkKeys(env.sessionStorage), []);
  assert.deepEqual(sdkKeys(env.localStorage), []);
});

test("a sessionStorage write failure rejects signIn", async () => {
  const env = createEnv({
    sessionStorage: { failKeys: new Set(["sari.auth.tokens"]) },
  });

  await assert.rejects(
    env.auth.signIn("admin", "correct"),
    /storage|store|session/i
  );

  assert.equal(env.sessionStorage.getItem("sari.auth.tokens"), null);
  assert.deepEqual(sdkKeys(env.sessionStorage), []);
});

test("unsupported challenges write no tokens", async () => {
  const env = createEnv();

  const result = await env.auth.signIn("mfa-user", "unsupported");

  assert.equal(result.status, "unsupported-challenge");
  assert.equal(result.signedIn, false);
  assert.equal(env.sessionStorage.getItem("sari.auth.tokens"), null);
  assert.deepEqual(sdkKeys(env.sessionStorage), []);
  assert.deepEqual(sdkKeys(env.localStorage), []);
  assert.equal(env.auth.isSignedIn(), false);
});

test("a re-challenge during completeNewPassword resolves and keeps the pending user", async () => {
  const env = createEnv();
  await env.auth.signIn("first-timer", "needs-new-password");

  const again = await env.auth.completeNewPassword("rechallenge", {
    email: "admin@example.com",
  });

  assert.equal(again.status, "challenge");
  assert.equal(again.challenge, "NEW_PASSWORD_REQUIRED");
  assert.deepEqual(again.requiredAttributes, ["email"]);
  assert.equal(again.signedIn, false);
  assert.equal(env.created.length, 1);

  const done = await env.auth.completeNewPassword("N3w-Password!", {
    email: "admin@example.com",
  });

  assert.equal(done.status, "signed-in");
  assert.equal(env.created.length, 1);
  assert.equal(env.created[0].completeCalls.length, 2);
  assert.equal(env.created[0].completeCalls[1].session, "second-challenge-session");
  assert.equal(
    JSON.parse(env.sessionStorage.getItem("sari.auth.tokens")).accessToken,
    "access-token-first-timer"
  );
  assert.deepEqual(sdkKeys(env.sessionStorage), []);
  assert.deepEqual(sdkKeys(env.localStorage), []);
});

test("a synchronous throw from the SDK clears the pending challenge", async () => {
  const env = createEnv();
  await env.auth.signIn("first-timer", "needs-new-password");

  await assert.rejects(
    env.auth.completeNewPassword("throw", {}),
    /password change/i
  );
  await assert.rejects(
    env.auth.completeNewPassword("Another-Pass1!", {}),
    /no password change is in progress/i
  );
  assert.equal(env.created[0].completeCalls.length, 1);
});

test("an invalid signIn leaves a pending password challenge intact", async () => {
  const env = createEnv();
  await env.auth.signIn("first-timer", "needs-new-password");

  await assert.rejects(env.auth.signIn("", ""), /username and password/i);

  const done = await env.auth.completeNewPassword("N3w-Password!", {
    email: "admin@example.com",
  });

  assert.equal(done.status, "signed-in");
  assert.equal(env.created.length, 1);
});

test("a double submit sends only one password-change request", async () => {
  const env = createEnv();
  await env.auth.signIn("first-timer", "needs-new-password");

  const first = env.auth.completeNewPassword("slow-complete", {
    email: "admin@example.com",
  });
  const pending = env.window.__pendingComplete;
  assert.ok(pending, "stub should hold the slow password change");

  await assert.rejects(
    env.auth.completeNewPassword("Second-Pass1!", {
      email: "admin@example.com",
    }),
    /already in progress/i
  );
  assert.equal(env.created[0].completeCalls.length, 1);

  pending.user.cacheTokens(pending.session);
  pending.callbacks.onSuccess(pending.session);

  const done = await first;
  assert.equal(done.status, "signed-in");
  assert.deepEqual(sdkKeys(env.sessionStorage), []);
});

test("a late onSuccess after signOut does not disturb a newer session", async () => {
  const env = createEnv();
  await env.auth.signIn("first-timer", "needs-new-password");

  const pendingResult = env.auth.completeNewPassword("slow-complete", {});
  const pending = env.window.__pendingComplete;
  assert.ok(pending, "stub should hold the slow password change");

  env.auth.signOut();
  const bob = await env.auth.signIn("bob", "correct");
  assert.equal(bob.status, "signed-in");

  // The real SDK caches tokens before it calls onSuccess.
  pending.user.cacheTokens(pending.session);
  pending.callbacks.onSuccess(pending.session);

  const result = await pendingResult;
  assert.equal(result.status, "stale");
  assert.equal(result.signedIn, false);
  assert.equal(
    JSON.parse(env.sessionStorage.getItem("sari.auth.tokens")).accessToken,
    "access-token-bob"
  );
  assert.deepEqual(sdkKeys(env.sessionStorage), []);
  assert.deepEqual(sdkKeys(env.localStorage), []);
});

test("a late onFailure after signOut does not disturb a newer session", async () => {
  const env = createEnv();
  await env.auth.signIn("first-timer", "needs-new-password");

  const pendingResult = env.auth.completeNewPassword("slow-fail", {});
  const pending = env.window.__pendingComplete;
  assert.ok(pending, "stub should hold the slow password change");

  env.auth.signOut();
  const bob = await env.auth.signIn("bob", "correct");
  assert.equal(bob.status, "signed-in");

  pending.callbacks.onFailure(new Error("late failure"));

  const result = await pendingResult;
  assert.equal(result.status, "stale");
  assert.equal(result.signedIn, false);
  assert.equal(
    JSON.parse(env.sessionStorage.getItem("sari.auth.tokens")).accessToken,
    "access-token-bob"
  );
  assert.deepEqual(sdkKeys(env.sessionStorage), []);
  assert.deepEqual(sdkKeys(env.localStorage), []);
});

test("attributeValues reach completeNewPasswordChallenge unchanged", async () => {
  const env = createEnv();
  await env.auth.signIn("first-timer", "needs-new-password");

  await env.auth.completeNewPassword("N3w-Password!", {
    email: "admin@example.com",
    name: "Admin",
  });

  assert.deepEqual(env.created[0].completeCalls[0].attributes, {
    email: "admin@example.com",
    name: "Admin",
  });
});
