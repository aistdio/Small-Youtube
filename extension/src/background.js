// Opens the welcome tab on install. Also lets an unpacked copy reload itself during development.
const isUnpacked = !chrome.runtime.getManifest().update_url;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  const { welcomeShown } = await chrome.storage.local.get('welcomeShown');
  if (welcomeShown) return;
  await chrome.storage.local.set({ welcomeShown: true });
  await chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'devReload' && isUnpacked) chrome.runtime.reload();
});
