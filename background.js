chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === "redirect" && sender.tab?.id) {
    chrome.tabs.update(sender.tab.id, {
      url: chrome.runtime.getURL("redirect/redirect.html")
    });
  }
});
