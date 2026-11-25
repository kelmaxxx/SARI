window.SARI_CONFIG = {

  useMockData: false,

  apiBaseUrl: "https://aroi5big4g.execute-api.ap-northeast-1.amazonaws.com",

  // Amazon Cognito hosted UI. Public SPA client: no client secret exists.
  auth: {
    userPoolId: "ap-northeast-1_yEBwYtgNE",
    clientId: "6ssbujsi5lq2bp90m00fjp2oh3",
    domain: "https://ap-northeast-1yebwytgne.auth.ap-northeast-1.amazoncognito.com",
    logoutUri: window.location.origin + "/index.html",
  },
};
