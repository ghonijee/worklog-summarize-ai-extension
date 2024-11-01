chrome.runtime.onInstalled.addListener(() => {
  console.log('Jira Resume Generator extension installed');
});

// Add CORS headers to the response
chrome.webRequest.onHeadersReceived.addListener(
  function(details) {
    const headers = details.responseHeaders;
    headers.push({
      name: 'Access-Control-Allow-Origin',
      value: chrome.runtime.getURL('')
    });
    headers.push({
      name: 'Access-Control-Allow-Credentials',
      value: 'true'
    });
    
    return { responseHeaders: headers };
  },
  {
    urls: [
      'https://*.atlassian.net/*',
      'https://*.jira.com/*'
    ]
  },
  ['blocking', 'responseHeaders', 'extraHeaders']
);

// Handle preflight requests
chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    const headers = details.requestHeaders;
    headers.push({
      name: 'Origin',
      value: chrome.runtime.getURL('')
    });
    
    return { requestHeaders: headers };
  },
  {
    urls: [
      'https://*.atlassian.net/*',
      'https://*.jira.com/*'
    ]
  },
  ['blocking', 'requestHeaders', 'extraHeaders']
);