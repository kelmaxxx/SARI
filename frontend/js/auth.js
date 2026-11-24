// Amazon Cognito sign-in for the SARI admin.
// Authorization Code Grant with PKCE (S256) against the hosted UI.
// Public SPA client: there is no client secret, and tokens never leave the browser.
// Passive on load: nothing happens until init(), signIn(), or signOut() is called.
window.SARI = window.SARI || {};

(function (SARI) {
  "use strict";

  var TOKENS_KEY = "sari.auth.tokens";
  var FLOW_KEY = "sari.auth.flow";
  var REFRESH_SKEW_MS = 60 * 1000;

  var initPromise = null;

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
    return !isMock() && Boolean(config && config.clientId && config.domain && config.redirectUri);
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
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (err) {
      // Storage can be full or blocked; the next read fails safely.
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

  function saveTokens(payload) {
    var previous = readTokens();
    var tokens = {
      accessToken: payload.access_token,
      idToken: payload.id_token || "",
      // A refresh response usually omits the refresh token; keep the old one.
      refreshToken: payload.refresh_token || (previous ? previous.refreshToken : ""),
      expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
    };
    writeJson(store(), TOKENS_KEY, tokens);
    return tokens;
  }

  function clearSession() {
    removeKey(store(), TOKENS_KEY);
    removeKey(store(), FLOW_KEY);
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
  function userFrom(tokens) {
    var claims = decodePayload(tokens && tokens.idToken);
    if (!claims) return null;
    return { email: claims.email || "", sub: claims.sub || "" };
  }

  // --- PKCE --------------------------------------------------------------

  function base64Url(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomString(byteLength) {
    var bytes = new Uint8Array(byteLength);
    window.crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  function challengeFor(verifier) {
    var data = new TextEncoder().encode(verifier);
    return window.crypto.subtle.digest("SHA-256", data).then(function (digest) {
      return base64Url(new Uint8Array(digest));
    });
  }

  // --- Token endpoint ----------------------------------------------------

  function endpoint(path) {
    return authConfig().domain.replace(/\/$/, "") + path;
  }

  function postToken(body) {
    return fetch(endpoint("/oauth2/token"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    }).then(
      function (res) {
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
      function () {
        var err = new Error(
          "Could not reach the sign-in service. Check your connection and try again."
        );
        err.network = true;
        throw err;
      }
    );
  }

  function needsRefresh(tokens) {
    return Number(tokens.expiresAt) - REFRESH_SKEW_MS <= Date.now();
  }

  function refreshTokens(tokens) {
    if (!tokens.refreshToken) {
      return Promise.resolve({ invalid: true });
    }

    return postToken({
      grant_type: "refresh_token",
      client_id: authConfig().clientId,
      refresh_token: tokens.refreshToken,
    }).then(
      function (payload) {
        return { tokens: saveTokens(payload) };
      },
      function (err) {
        // Keep the session through network or server hiccups. Clear it only
        // when Cognito says the refresh token itself is no longer valid.
        if (err.code === "invalid_grant") return { invalid: true };
        return { invalid: false, error: err };
      }
    );
  }

  // --- Callback ----------------------------------------------------------

  function stripQuery() {
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    } catch (err) {
      // Some contexts block history changes; the page still works.
    }
  }

  function handleCallback() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code");
    var error = params.get("error");
    if (!code && !error) return Promise.resolve({ handled: false, error: null });

    var flow = readJson(store(), FLOW_KEY);
    removeKey(store(), FLOW_KEY);
    stripQuery();

    if (error) {
      return Promise.resolve({
        handled: true,
        error:
          error === "access_denied"
            ? "Sign-in was cancelled."
            : params.get("error_description") || "Sign-in failed. Please try again.",
      });
    }

    if (!flow || !flow.verifier || !flow.state || params.get("state") !== flow.state) {
      return Promise.resolve({
        handled: true,
        error: "Sign-in could not be verified. Please try again.",
      });
    }

    return postToken({
      grant_type: "authorization_code",
      client_id: authConfig().clientId,
      code: code,
      redirect_uri: flow.redirectUri || authConfig().redirectUri,
      code_verifier: flow.verifier,
    }).then(
      function (payload) {
        saveTokens(payload);
        return { handled: true, error: null };
      },
      function (err) {
        return { handled: true, error: err.message || "Sign-in failed. Please try again." };
      }
    );
  }

  // --- Public API --------------------------------------------------------

  function runInit() {
    if (!isEnabled()) {
      return Promise.resolve({ enabled: false, signedIn: false, user: null, error: null });
    }

    return handleCallback().then(function (callback) {
      if (callback.error) {
        return { enabled: true, signedIn: false, user: null, error: callback.error };
      }

      var tokens = readTokens();
      if (!tokens) {
        return { enabled: true, signedIn: false, user: null, error: null };
      }

      if (!needsRefresh(tokens)) {
        return { enabled: true, signedIn: true, user: userFrom(tokens), error: null };
      }

      return refreshTokens(tokens).then(function (result) {
        if (result.tokens) {
          return { enabled: true, signedIn: true, user: userFrom(result.tokens), error: null };
        }

        if (result.invalid) {
          clearSession();
          return {
            enabled: true,
            signedIn: false,
            user: null,
            error: "Your session has expired. Please sign in again.",
          };
        }

        // Temporary failure: keep the stored session so a later retry can succeed.
        return {
          enabled: true,
          signedIn: true,
          user: userFrom(tokens),
          error: "Could not refresh your session. Check your connection and try again.",
        };
      });
    });
  }

  function init() {
    if (!initPromise) initPromise = runInit();
    return initPromise;
  }

  function signIn() {
    if (!isEnabled()) return Promise.resolve();

    var storage = store();
    if (!storage) {
      return Promise.reject(
        new Error("This browser blocked session storage, so sign-in cannot start.")
      );
    }

    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(
        new Error("Sign-in needs a secure context. Use http://localhost:8123 or HTTPS.")
      );
    }

    var config = authConfig();
    var verifier = randomString(32);
    var state = randomString(16);

    writeJson(storage, FLOW_KEY, {
      verifier: verifier,
      state: state,
      redirectUri: config.redirectUri,
    });

    return challengeFor(verifier).then(function (challenge) {
      var params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        scope: config.scopes || "openid email",
        redirect_uri: config.redirectUri,
        state: state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      window.location.assign(endpoint("/oauth2/authorize") + "?" + params.toString());
    });
  }

  function signOut() {
    clearSession();
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
      if (result.tokens) return result.tokens.accessToken;
      if (result.invalid) {
        clearSession();
        return null;
      }
      // Temporary failure: the stored session is kept; the next call retries.
      return null;
    });
  }

  function getUser() {
    return userFrom(readTokens());
  }

  SARI.auth = {
    isEnabled: isEnabled,
    init: init,
    signIn: signIn,
    signOut: signOut,
    getAccessToken: getAccessToken,
    getUser: getUser,
  };
})(window.SARI);
