// Amazon Cognito sign-in for the SARI admin.
// USER_SRP_AUTH through amazon-cognito-identity-js. The password goes only to
// Cognito over SRP, never to our API, and is never logged or stored.
// Public SPA client: there is no client secret, and tokens stay in sessionStorage.
// Passive on load: nothing happens until init(), signIn(), or signOut() is called.
window.SARI = window.SARI || {};

(function (SARI) {
  "use strict";

  var TOKENS_KEY = "sari.auth.tokens";
  var REFRESH_SKEW_MS = 60 * 1000;
  var TOKEN_TIMEOUT_MS = 15 * 1000;
  // Keys the Cognito SDK writes when it caches a session.
  var SDK_KEY_PREFIX = "CognitoIdentityServiceProvider.";

  var initPromise = null;
  var refreshPromise = null;
  var userPoolInstance = null;
  // Bumped by signIn()/signOut(); stale callbacks must not touch the session.
  var authEpoch = 0;
  // NEW_PASSWORD_REQUIRED continuation; memory only, never storage.
  var pendingUser = null;
  var pendingRequiredAttributes = null;

  // --- Config and mode ---------------------------------------------------

  function authConfig() {
    return (window.SARI_CONFIG && window.SARI_CONFIG.auth) || null;
  }

  // Mirrors api.js: mock mode unless useMockData is explicitly false.
  function isMock() {
    return (window.SARI_CONFIG || {}).useMockData !== false;
  }

  function isEnabled() {
    var config = authConfig();
    return (
      !isMock() &&
      Boolean(config && config.userPoolId && config.clientId && config.domain)
    );
  }

  // --- SDK ---------------------------------------------------------------

  // Built lazily so loading a page never touches storage.
  function userPool() {
    if (userPoolInstance) return userPoolInstance;

    var config = authConfig();
    var sdk = window.AmazonCognitoIdentity;
    var storage = store();

    if (
      !sdk ||
      typeof sdk.CognitoUserPool !== "function" ||
      typeof sdk.CognitoUser !== "function" ||
      typeof sdk.AuthenticationDetails !== "function"
    ) {
      throw new Error("The sign-in library did not load. Reload the page and try again.");
    }
    if (!config || !config.userPoolId || !config.clientId) {
      throw new Error("Sign-in is not configured correctly. Contact the site owner.");
    }
    if (!storage) {
      throw new Error("This browser blocked session storage, so sign-in cannot start.");
    }

    userPoolInstance = new sdk.CognitoUserPool({
      UserPoolId: config.userPoolId,
      ClientId: config.clientId,
      // Never let the SDK default to localStorage.
      Storage: storage,
    });
    return userPoolInstance;
  }

  // --- Storage -----------------------------------------------------------

  function store() {
    try {
      return window.sessionStorage;
    } catch (err) {
      return null;
    }
  }

  function readJson(storage, key) {
    if (!storage) return null;
    try {
      var raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeJson(storage, key, value) {
    if (!storage) return false;
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      // Storage can be full or blocked; the caller decides how to report it.
      return false;
    }
  }

  function removeKey(storage, key) {
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch (err) {
      // Nothing stored means nothing to clear.
    }
  }

  function readTokens() {
    var tokens = readJson(store(), TOKENS_KEY);
    if (!tokens || !tokens.accessToken || !tokens.expiresAt) return null;
    return tokens;
  }

  // `previous` is only passed by the refresh grant. A fresh sign-in must never
  // inherit an older identity's refresh token.
  function saveTokens(payload, previous) {
    var tokens = {
      accessToken: payload.access_token,
      idToken: payload.id_token || "",
      // A refresh response usually omits the refresh token; keep the old one.
      refreshToken: payload.refresh_token || (previous ? previous.refreshToken : ""),
      expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
    };
    if (!writeJson(store(), TOKENS_KEY, tokens)) {
      throw new Error(
        "Your browser could not save the sign-in session. Check that storage is enabled and try again."
      );
    }
    return tokens;
  }

  // Remove only this app client's SDK keys; other keys are left alone.
  function clearSdkKeys(storage) {
    var config = authConfig();
    if (!storage || !config || !config.clientId) return;

    var prefix = SDK_KEY_PREFIX + config.clientId + ".";
    try {
      var keys = [];
      for (var i = 0; i < storage.length; i += 1) {
        var key = storage.key(i);
        if (key && key.indexOf(prefix) === 0) keys.push(key);
      }
      for (var j = 0; j < keys.length; j += 1) {
        storage.removeItem(keys[j]);
      }
    } catch (err) {
      // Storage can be blocked; there is nothing else to clear.
    }
  }

  function localStorageOrNull() {
    try {
      return window.localStorage;
    } catch (err) {
      return null;
    }
  }

  // Earlier builds let the SDK default to localStorage, so purge those
  // leftovers as well as the current sessionStorage cache.
  function clearSdkSession(storage) {
    clearSdkKeys(storage);
    clearSdkKeys(localStorageOrNull());
  }

  function clearSession() {
    var storage = store();
    removeKey(storage, TOKENS_KEY);
    clearSdkSession(storage);
  }

  // The challenge Session lives on the user object in memory; drop it on
  // sign-out, failure, or a new attempt.
  function clearPendingChallenge() {
    pendingUser = null;
    pendingRequiredAttributes = null;
  }

  // Only clear the session this failure belongs to; a new sign-in may have
  // replaced it while the request was in flight.
  function clearIfCurrent(tokens) {
    var current = readTokens();
    // Nothing of this session remains; a newer sign-in may own the stored session.
    if (!current) return;
    if (current.refreshToken === (tokens && tokens.refreshToken)) {
      clearSession();
    }
  }

  // --- Identity ----------------------------------------------------------

  function decodePayload(token) {
    try {
      var part = String(token || "").split(".")[1];
      if (!part) return null;
      var padded = part.replace(/-/g, "+").replace(/_/g, "/");
      while (padded.length % 4) padded += "=";
      var json = decodeURIComponent(
        atob(padded)
          .split("")
          .map(function (char) {
            return "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2);
          })
          .join("")
      );
      return JSON.parse(json);
    } catch (err) {
      return null;
    }
  }

  // Display-only identity. Authorization always uses the access token.
  // These claims are decoded, not verified; never gate access on them.
  function userFrom(tokens) {
    var claims = decodePayload(tokens && tokens.idToken);
    if (!claims) return null;
    return { email: claims.email || "", sub: claims.sub || "" };
  }

  // --- Token endpoint ----------------------------------------------------

  function endpoint(path) {
    return authConfig().domain.replace(/\/$/, "") + path;
  }

  function postToken(body) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var options = {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    };
    var timer = null;

    if (controller) {
      options.signal = controller.signal;
      // shortcut: no request timeout when AbortController is missing.
      timer = setTimeout(function () {
        controller.abort();
      }, TOKEN_TIMEOUT_MS);
    }

    function stopTimer() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    var request;
    try {
      request = fetch(endpoint("/oauth2/token"), options);
    } catch (err) {
      // A synchronous throw still owns the abort timer.
      stopTimer();
      throw err;
    }

    return request.then(
      function (res) {
        stopTimer();
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (payload) {
            if (!res.ok) {
              var err = new Error(
                payload.error_description ||
                  payload.error ||
                  "The sign-in service rejected the request."
              );
              err.code = payload.error || "";
              err.status = res.status;
              throw err;
            }
            if (!payload.access_token) {
              throw new Error("The sign-in response did not include an access token.");
            }
            return payload;
          });
      },
      function (err) {
        stopTimer();
        var timedOut = Boolean(controller && err && err.name === "AbortError");
        var failure = new Error(
          timedOut
            ? "The sign-in service did not respond in time. Check your connection and try again."
            : "Could not reach the sign-in service. Check your connection and try again."
        );
        failure.network = true;
        failure.timeout = timedOut;
        throw failure;
      }
    );
  }

  function needsRefresh(tokens) {
    return Number(tokens.expiresAt) - REFRESH_SKEW_MS <= Date.now();
  }

  // A permanent misconfiguration; retrying will not help.
  function isConfigError(err) {
    return (
      err.code === "invalid_client" ||
      err.code === "unauthorized_client" ||
      err.code === "invalid_request" ||
      err.code === "unsupported_grant_type"
    );
  }

  // Resolves to one of:
  //   { status: "ok", tokens }
  //   { status: "invalid" }     refresh token rejected (invalid_grant)
  //   { status: "config" }      client/configuration rejected
  //   { status: "unavailable" } network or server failure; tokens kept
  //   { status: "stale" }       session was replaced while in flight
  function refreshTokens(tokens) {
    // Single-flight: concurrent callers share one refresh request.
    if (refreshPromise) return refreshPromise;
    if (!tokens || !tokens.refreshToken) return Promise.resolve({ status: "invalid" });

    var request;
    try {
      request = postToken({
        grant_type: "refresh_token",
        client_id: authConfig().clientId,
        refresh_token: tokens.refreshToken,
      });
    } catch (err) {
      return Promise.resolve({ status: "unavailable", error: err });
    }

    var settled = request.then(
      function (payload) {
        var current = readTokens();
        // A new sign-in replaced the session while this request was in flight.
        if (!current || current.refreshToken !== tokens.refreshToken) {
          return { status: "stale" };
        }
        return { status: "ok", tokens: saveTokens(payload, tokens) };
      },
      function (err) {
        if (err.code === "invalid_grant") return { status: "invalid" };
        if (isConfigError(err)) return { status: "config", error: err };
        return { status: "unavailable", error: err };
      }
    );

    var shared = settled.then(
      function (result) {
        if (refreshPromise === shared) refreshPromise = null;
        return result;
      },
      function (err) {
        if (refreshPromise === shared) refreshPromise = null;
        return { status: "unavailable", error: err };
      }
    );
    refreshPromise = shared;
    return shared;
  }

  // --- Sign-in -----------------------------------------------------------

  function signedInResult(tokens) {
    return {
      status: "signed-in",
      signedIn: true,
      challenge: null,
      user: userFrom(tokens),
      error: null,
    };
  }

  // Phase 5 collects the new password and required attribute values; nothing is
  // stored here.
  function challengeResult(name, requiredAttributes) {
    return {
      status: "challenge",
      signedIn: false,
      challenge: name,
      requiredAttributes: requiredAttributes || [],
      user: null,
      error: null,
    };
  }

  function staleResult() {
    return {
      status: "stale",
      signedIn: false,
      challenge: null,
      requiredAttributes: null,
      user: null,
      error: null,
    };
  }

  function unsupportedChallenge(name) {
    return {
      status: "unsupported-challenge",
      signedIn: false,
      challenge: name,
      user: null,
      error:
        "This account needs an extra verification step that this page does not support yet.",
    };
  }

  function signInError(err) {
    var code = (err && err.code) || "";
    var message;

    if (code === "NotAuthorizedException" || code === "UserNotFoundException") {
      // Same message either way: do not reveal which accounts exist.
      message = "Incorrect username or password.";
    } else if (code === "UserNotConfirmedException") {
      message = "This account has not been confirmed yet.";
    } else if (code === "PasswordResetRequiredException") {
      message = "This account needs a password reset.";
    } else if (code === "TooManyRequestsException" || code === "LimitExceededException") {
      message = "Too many sign-in attempts. Wait a moment and try again.";
    } else {
      message = (err && err.message) || "Sign-in failed. Please try again.";
    }

    var failure = new Error(message);
    failure.code = code;
    return failure;
  }

  // Map the SDK session onto the existing SARI token record.
  function saveSession(session) {
    var access = session.getAccessToken();
    var id = session.getIdToken();
    var refresh = session.getRefreshToken();

    if (!access || typeof access.getJwtToken !== "function") {
      throw new Error("The sign-in response did not include an access token.");
    }

    var expiresAt = Number(access.getExpiration()) * 1000;
    var expiresIn = Math.max(1, Math.round((expiresAt - Date.now()) / 1000));

    return saveTokens(
      {
        access_token: access.getJwtToken(),
        id_token: id ? id.getJwtToken() : "",
        refresh_token: refresh ? refresh.getToken() : "",
        expires_in: expiresIn,
      },
      null
    );
  }

  // Save SARI's record, then drop the SDK's duplicate cache so there is one
  // token store. A failed save must not leave the SDK's copy behind either.
  function finishSignIn(session) {
    var tokens;
    try {
      tokens = saveSession(session);
    } catch (err) {
      clearSdkSession(store());
      throw err;
    }
    clearSdkSession(store());
    return signedInResult(tokens);
  }

  function signIn(username, password) {
    var epoch = ++authEpoch;
    clearPendingChallenge();

    if (!isEnabled()) {
      return Promise.reject(
        new Error("Sign-in is not configured for this site. Contact the site owner.")
      );
    }

    // Trim the username; the password is passed through untouched.
    var name = username == null ? "" : String(username).trim();
    if (!name || typeof password !== "string" || password === "") {
      return Promise.reject(new Error("Enter your username and password to sign in."));
    }

    var pool;
    var storage;
    try {
      pool = userPool();
      storage = store();
    } catch (err) {
      return Promise.reject(err);
    }

    var sdk = window.AmazonCognitoIdentity;
    // CognitoUser does not inherit the pool's Storage; without this it caches
    // tokens in localStorage.
    var user = new sdk.CognitoUser({
      Username: name,
      Pool: pool,
      Storage: storage,
    });
    var details = new sdk.AuthenticationDetails({ Username: name, Password: password });

    // Never carry a previous identity's tokens into a new login.
    clearSession();
    refreshPromise = null;
    initPromise = null;

    return new Promise(function (resolve, reject) {
      user.authenticateUser(details, {
        onSuccess: function (session) {
          if (epoch !== authEpoch) {
            // A late callback from a signed-out or replaced attempt.
            clearSdkSession(store());
            resolve(staleResult());
            return;
          }
          try {
            resolve(finishSignIn(session));
          } catch (err) {
            reject(err);
          }
        },
        onFailure: function (err) {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          reject(signInError(err));
        },
        newPasswordRequired: function (userAttributes, requiredAttributes) {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          // Keep the instance: its in-memory Session is the challenge.
          pendingUser = user;
          pendingRequiredAttributes = requiredAttributes || [];
          resolve(challengeResult("NEW_PASSWORD_REQUIRED", pendingRequiredAttributes));
        },
        mfaRequired: function (challengeName) {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          resolve(unsupportedChallenge(challengeName || "SMS_MFA"));
        },
        totpRequired: function () {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          resolve(unsupportedChallenge("SOFTWARE_TOKEN_MFA"));
        },
        customChallenge: function () {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          resolve(unsupportedChallenge("CUSTOM_CHALLENGE"));
        },
        selectMFAType: function () {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          resolve(unsupportedChallenge("SELECT_MFA_TYPE"));
        },
        mfaSetup: function () {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          resolve(unsupportedChallenge("MFA_SETUP"));
        },
      });
    });
  }

  function completeNewPassword(newPassword, attributeValues) {
    if (!isEnabled()) {
      return Promise.reject(
        new Error("Sign-in is not configured for this site. Contact the site owner.")
      );
    }

    var user = pendingUser;
    if (!user) {
      return Promise.reject(
        new Error("No password change is in progress. Sign in again.")
      );
    }
    if (typeof newPassword !== "string" || newPassword === "") {
      return Promise.reject(new Error("Enter a new password."));
    }

    var epoch = authEpoch;
    var attributes = attributeValues || {};

    return new Promise(function (resolve, reject) {
      // 6.3.22 signature: (newPassword, requiredAttributeData, callback, clientMetadata).
      user.completeNewPasswordChallenge(newPassword, attributes, {
        onSuccess: function (session) {
          if (epoch !== authEpoch) {
            clearSdkSession(store());
            resolve(staleResult());
            return;
          }
          clearPendingChallenge();
          try {
            resolve(finishSignIn(session));
          } catch (err) {
            reject(err);
          }
        },
        onFailure: function (err) {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          clearPendingChallenge();
          reject(signInError(err));
        },
        mfaRequired: function (challengeName) {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          clearPendingChallenge();
          resolve(unsupportedChallenge(challengeName || "SMS_MFA"));
        },
        totpRequired: function () {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          clearPendingChallenge();
          resolve(unsupportedChallenge("SOFTWARE_TOKEN_MFA"));
        },
        customChallenge: function () {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          clearPendingChallenge();
          resolve(unsupportedChallenge("CUSTOM_CHALLENGE"));
        },
        selectMFAType: function () {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          clearPendingChallenge();
          resolve(unsupportedChallenge("SELECT_MFA_TYPE"));
        },
        mfaSetup: function () {
          if (epoch !== authEpoch) {
            resolve(staleResult());
            return;
          }
          clearPendingChallenge();
          resolve(unsupportedChallenge("MFA_SETUP"));
        },
      });
    });
  }

  // --- Public API --------------------------------------------------------

  // init() resolves to { enabled, status, signedIn, user, error }.
  // status: "signed-in"  a usable access token exists
  //         "signed-out"  the user must sign in again
  //         "unavailable" temporary refresh failure; tokens kept, retry later
  //         "disabled"    mock mode or no auth config
  function unavailableResult() {
    return {
      enabled: true,
      status: "unavailable",
      signedIn: false,
      user: null,
      error: "Could not refresh your session. Check your connection and try again.",
    };
  }

  function runInit() {
    if (!isEnabled()) {
      return Promise.resolve({
        enabled: false,
        status: "disabled",
        signedIn: false,
        user: null,
        error: null,
      });
    }

    var tokens = readTokens();
    if (!tokens) {
      return Promise.resolve({
        enabled: true,
        status: "signed-out",
        signedIn: false,
        user: null,
        error: null,
      });
    }

    if (!needsRefresh(tokens)) {
      return Promise.resolve({
        enabled: true,
        status: "signed-in",
        signedIn: true,
        user: userFrom(tokens),
        error: null,
      });
    }

    return refreshTokens(tokens).then(function (result) {
      if (result.status === "ok") {
        return {
          enabled: true,
          status: "signed-in",
          signedIn: true,
          user: userFrom(result.tokens),
          error: null,
        };
      }

      if (result.status === "stale") {
        var current = readTokens();
        if (!current) {
          return {
            enabled: true,
            status: "signed-out",
            signedIn: false,
            user: null,
            error: null,
          };
        }
        if (!needsRefresh(current)) {
          return {
            enabled: true,
            status: "signed-in",
            signedIn: true,
            user: userFrom(current),
            error: null,
          };
        }
        return unavailableResult();
      }

      if (result.status === "invalid") {
        clearIfCurrent(tokens);
        return {
          enabled: true,
          status: "signed-out",
          signedIn: false,
          user: null,
          error: "Your session has expired. Please sign in again.",
        };
      }

      if (result.status === "config") {
        clearIfCurrent(tokens);
        return {
          enabled: true,
          status: "signed-out",
          signedIn: false,
          user: null,
          error: "Sign-in is not configured correctly. Contact the site owner.",
        };
      }

      // Temporary failure: keep the tokens, but do not pretend the admin is usable.
      return unavailableResult();
    });
  }

  function initFailure(err) {
    return {
      enabled: true,
      status: "unavailable",
      signedIn: false,
      user: null,
      error: (err && err.message) || "Could not start sign-in. Please try again.",
    };
  }

  function init() {
    if (!initPromise) {
      var started;
      try {
        started = runInit();
      } catch (err) {
        // A synchronous throw must not escape init(); the next call retries.
        return Promise.resolve(initFailure(err));
      }
      initPromise = started.then(
        function (result) {
          // Do not cache a temporary failure; the next init() retries.
          if (result.status === "unavailable") initPromise = null;
          return result;
        },
        function (err) {
          initPromise = null;
          return initFailure(err);
        }
      );
    }
    return initPromise;
  }

  // True when a stored session exists; init() decides whether it is still usable.
  function isSignedIn() {
    return Boolean(readTokens());
  }

  function signOut() {
    // Invalidates in-flight callbacks and drops any pending password challenge.
    authEpoch += 1;
    clearPendingChallenge();

    // Clears SARI's tokens and this client's SDK keys from both stores.
    clearSession();
    refreshPromise = null;
    initPromise = null;
    if (!isEnabled()) return;

    var config = authConfig();
    var params = new URLSearchParams({
      client_id: config.clientId,
      logout_uri: config.logoutUri,
    });
    window.location.assign(endpoint("/logout") + "?" + params.toString());
  }

  function getAccessToken() {
    if (!isEnabled()) return Promise.resolve(null);

    var tokens = readTokens();
    if (!tokens) return Promise.resolve(null);
    if (!needsRefresh(tokens)) return Promise.resolve(tokens.accessToken);

    return refreshTokens(tokens).then(function (result) {
      if (result.status === "ok") return result.tokens.accessToken;

      if (result.status === "stale") {
        var current = readTokens();
        return current && !needsRefresh(current) ? current.accessToken : null;
      }

      if (result.status === "invalid" || result.status === "config") {
        clearIfCurrent(tokens);
      }
      // Temporary failures keep the stored session; the next call retries.
      return null;
    });
  }

  function getUser() {
    return userFrom(readTokens());
  }

  SARI.auth = {
    isEnabled: isEnabled,
    isSignedIn: isSignedIn,
    init: init,
    signIn: signIn,
    completeNewPassword: completeNewPassword,
    signOut: signOut,
    getAccessToken: getAccessToken,
    getUser: getUser,
  };
})(window.SARI);
