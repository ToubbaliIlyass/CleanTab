document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get("reason");
  const originalUrl = params.get("original");

  const reasonEl = document.getElementById("reason-text");
  if (reasonEl) {
    reasonEl.textContent =
      reason ||
      "This site is known to contain explicit content and was blocked automatically.";
  }

  const appealBtn = document.getElementById("appeal-btn");
  const appealStatus = document.createElement("div");
  appealStatus.id = "appeal-status";
  appealStatus.className = "appeal-status";

  if (appealBtn) {
    appealBtn.parentNode.insertBefore(appealStatus, appealBtn.nextSibling);

    appealBtn.addEventListener("click", () => {
      // Reset states and show processing
      appealBtn.disabled = true;
      appealBtn.className = "appeal-button processing";
      appealBtn.textContent = "Processing appeal...";
      appealStatus.className = "appeal-status";
      appealStatus.innerHTML = "";

      chrome.runtime.sendMessage({ action: "appealRequest" }, (response) => {
        console.log("Appeal response received:", response);

        // Check if we received any response at all
        if (!response) {
          console.error("No response received from background script");
          appealBtn.className = "appeal-button error";
          appealBtn.textContent = "⚠️ Connection Error";

          appealStatus.className = "appeal-status error show";
          appealStatus.innerHTML = `
            <div><strong>⚠️ Connection Error</strong></div>
            <div style="margin-top: 6px; font-weight: 400;">Unable to communicate with the background service. Please reload the page and try again.</div>
          `;

          setTimeout(() => {
            appealBtn.disabled = false;
            appealBtn.className = "";
            appealBtn.textContent = "Try Again";
          }, 5000);
          return;
        }

        // Check for unknown response format
        if (!response.status) {
          console.error("Invalid response format:", response);
          appealBtn.className = "error";
          appealBtn.textContent = "⚠️ Invalid Response";

          appealStatus.className = "appeal-status error show";
          appealStatus.innerHTML = `
            <div><strong>⚠️ Invalid Response</strong></div>
            <div style="margin-top: 6px; font-weight: 400;">Received unexpected response format. Please try again.</div>
          `;

          setTimeout(() => {
            appealBtn.disabled = false;
            appealBtn.className = "";
            appealBtn.textContent = "Try Again";
          }, 3000);
          return;
        }

        if (response.status === "approved") {
          // Success state
          appealBtn.className = "appeal-button success";
          appealBtn.textContent = "✅ Appeal Approved";

          if (response.aiApproved) {
            appealStatus.className = "appeal-status ai-approved show";
            appealStatus.innerHTML = `
              <div><strong>🤖 AI Analysis Approved</strong></div>
              <div style="margin-top: 6px; font-weight: 400;">${response.reason}</div>
            `;
          } else {
            appealStatus.className = "appeal-status success show";
            appealStatus.innerHTML = `
              <div><strong>🎉 Appeal Approved</strong></div>
              <div style="margin-top: 6px; font-weight: 400;">${response.reason}</div>
            `;
          }

          setTimeout(() => {
            appealStatus.innerHTML = `
              <div><strong>🔄 Redirecting to original page...</strong></div>
              <div style="margin-top: 6px; font-weight: 400;">Taking you back in a moment.</div>
            `;
            setTimeout(() => {
              window.location.href = response.originalUrl || originalUrl || "/";
            }, 1000);
          }, 2500);
        } else if (response.status === "denied") {
          if (response.permanent) {
            appealBtn.className = "appeal-button error";
            appealBtn.textContent = "🚫 Cannot Appeal";
            appealBtn.disabled = true;

            appealStatus.className = "appeal-status error show";
            appealStatus.innerHTML = `
              <div><strong>⛔ Permanently Blocked</strong></div>
              <div style="margin-top: 6px; font-weight: 400;">${response.reason}</div>
            `;
          } else if (response.cooldown) {
            appealBtn.className = "appeal-button warning";
            appealBtn.textContent = "⏰ Rate Limited";

            appealStatus.className = "appeal-status warning show";
            appealStatus.innerHTML = `
              <div><strong>⏱️ Too Many Appeals</strong></div>
              <div style="margin-top: 6px; font-weight: 400;">${response.reason}</div>
            `;

            setTimeout(() => {
              appealBtn.disabled = false;
              appealBtn.className = "appeal-button";
              appealBtn.textContent = "Try Appeal Again";
            }, 8000);
          } else {
            appealBtn.className = "appeal-button error";
            appealBtn.textContent = "❌ Appeal Denied";

            let statusContent = `
              <div><strong>❌ Appeal Denied</strong></div>
              <div style="margin-top: 6px; font-weight: 400;">${response.reason}</div>
            `;

            if (response.aiAnalyzed) {
              statusContent += `<small>AI Confidence: ${Math.round((response.confidence || 0) * 100)}%</small>`;
            }

            if (response.reviewable) {
              statusContent += `<small>You can try appealing again later if this was blocked incorrectly.</small>`;
            }

            appealStatus.className = "appeal-status error show";
            appealStatus.innerHTML = statusContent;

            setTimeout(() => {
              appealBtn.disabled = false;
              appealBtn.className = "appeal-button";
              appealBtn.textContent = "Try Again Later";
            }, 10000);
          }
        } else {
          // This should now be very rare - only for truly unexpected responses
          console.error("Unexpected appeal response status:", response);
          appealBtn.className = "appeal-button error";
          appealBtn.textContent = "⚠️ Unexpected Error";

          appealStatus.className = "appeal-status error show";
          appealStatus.innerHTML = `
            <div><strong>⚠️ Unexpected Error</strong></div>
            <div style="margin-top: 6px; font-weight: 400;">Received an unexpected response. Please try again or reload the page.</div>
          `;

          setTimeout(() => {
            appealBtn.disabled = false;
            appealBtn.className = "appeal-button";
            appealBtn.textContent = "Try Again";
          }, 5000);
        }
      });
    });
  }

  // ========================
  // New Features Implementation
  // ========================

  // Load and display streak
  function loadStreak() {
    chrome.storage.local.get(["currentStreak"], (data) => {
      const streak = data.currentStreak || 1;
      const streakElement = document.getElementById("streakValue");
      if (streakElement) {
        streakElement.textContent = `Day ${streak}`;
      }
    });
  }

  // Micro-actions list
  const microActions = [
    "Do 10 pushups",
    "Drink a glass of water",
    "Clean your desk for 2 minutes",
    "Review your goals",
    "Read 1 page of a book",
    "Journal 3 lines",
    "Take 5 deep breaths",
    "Stretch for 30 seconds",
    "Write down one thing you're grateful for",
    "Tidy up your immediate area",
  ];

  // 60-second countdown functionality
  function startCountdown() {
    const overlay = document.getElementById("countdownOverlay");
    const numberElement = document.getElementById("countdownNumber");
    const skipButton = document.getElementById("countdownSkip");

    if (!overlay || !numberElement) return;

    let timeLeft = 60;
    overlay.classList.add("active");

    const interval = setInterval(() => {
      timeLeft--;
      numberElement.textContent = timeLeft;

      if (timeLeft <= 0) {
        clearInterval(interval);
        showCompletionMessage();
      }
    }, 1000);

    // Skip functionality
    skipButton.onclick = () => {
      clearInterval(interval);
      overlay.classList.remove("active");
    };

    function showCompletionMessage() {
      overlay.classList.add("countdown-complete");
      numberElement.textContent = "You're back in control.";

      setTimeout(() => {
        overlay.classList.remove("active");
        overlay.classList.remove("countdown-complete");
        numberElement.textContent = "60"; // Reset for next use
      }, 3000);
    }
  }

  // Random micro-action generator
  function generateMicroAction() {
    const randomIndex = Math.floor(Math.random() * microActions.length);
    const action = microActions[randomIndex];
    const descriptionElement = document.getElementById("microDescription");

    if (descriptionElement) {
      descriptionElement.textContent = action;

      // Reset after 5 seconds
      setTimeout(() => {
        descriptionElement.textContent = "Build momentum with micro-habits";
      }, 5000);
    }
  }

  // Initialize new features
  loadStreak();

  // Connect buttons to functionality
  const resetButton = document.getElementById("resetButton");
  const microActionButton = document.getElementById("microActionButton");

  if (resetButton) {
    resetButton.addEventListener("click", startCountdown);
  }

  if (microActionButton) {
    microActionButton.addEventListener("click", generateMicroAction);
  }
});
