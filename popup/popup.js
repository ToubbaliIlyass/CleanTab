chrome.storage.local.get(["redirectsToday"], (data) => {
  document.getElementById("redirects").textContent = data.redirectsToday ?? 0;
});
