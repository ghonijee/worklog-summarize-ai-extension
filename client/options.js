// Add this to your existing options page code
document.getElementById('openRouterApiKey').addEventListener('change', async (e) => {
  const apiKey = e.target.value.trim();
  await chrome.storage.local.set({ openRouterApiKey: apiKey });
});

// Load saved API key when options page opens
document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get('openRouterApiKey');
  if (result.openRouterApiKey) {
    document.getElementById('openRouterApiKey').value = result.openRouterApiKey;
  }
}); 