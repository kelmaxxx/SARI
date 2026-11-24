window.SARI_CONFIG = {

  useMockData: false,

  apiBaseUrl: "https://aroi5big4g.execute-api.ap-northeast-1.amazonaws.com",

  // Amazon Cognito hosted UI. Public SPA client: no client secret exists.
  auth: {
    clientId: "6ssbujsi5lq2bp90m00fjp2oh3",
    domain: "https://ap-northeast-1yebwytgne.auth.ap-northeast-1.amazoncognito.com",
    redirectUri: "http://localhost:8123/admin.html",
    logoutUri: "http://localhost:8123/index.html",
    scopes: "openid email",
  },
};
