chrome.runtime.onMessage.addListener((msg, sender) => {
  // Only care about redirect requests
  if (msg.action !== "redirect" || !sender.tab?.id) return;

  // 1. Perform the redirect
  chrome.tabs.update(sender.tab.id, {
    url: chrome.runtime.getURL("redirect/redirect.html"),
  });

  // 2. Update redirect statistics
  chrome.storage.local.get(["redirectsToday", "lastReset"], (data) => {
    const today = new Date().toISOString().slice(0, 10);

    let redirectsToday = data.redirectsToday ?? 0;
    let lastReset = data.lastReset ?? today;

    // Reset daily counter if day changed
    if (lastReset !== today) {
      redirectsToday = 0;
      lastReset = today;
    }

    redirectsToday += 1;

    chrome.storage.local.set({
      redirectsToday,
      lastReset,
    });
  });
});
