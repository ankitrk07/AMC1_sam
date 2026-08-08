document.addEventListener('DOMContentLoaded', function () {

  /* ---- Footer year ---- */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---- Sticky enroll bar: appears once the visitor scrolls past
         the primary CTA button under the video ---- */
  var ctaAnchor = document.getElementById('ctaAnchor');
  var stickyCta = document.getElementById('stickyCta');

  if (ctaAnchor && stickyCta) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          stickyCta.classList.remove('is-visible');
        } else if (entry.boundingClientRect.top < 0) {
          stickyCta.classList.add('is-visible');
        } else {
          stickyCta.classList.remove('is-visible');
        }
      });
    }, { threshold: 0 });
    observer.observe(ctaAnchor);
  }

  /* ---- VSL video: instant auto-start + controls ---- */
  var video = document.getElementById('vslVideo');
  var playBtn = document.getElementById('vslPlayBtn');
  var playLabel = document.getElementById('vslPlayLabel');
  var playIcon = document.getElementById('vslPlayIcon');
  var soundBtn = document.getElementById('vslSoundBtn');
  var soundLabel = document.getElementById('vslSoundLabel');
  var soundIcon = document.getElementById('vslSoundIcon');

  if (video) {
    video.preload = 'auto';
    var startVideo = function () {
      video.play().catch(function () { });
    };
    if (video.readyState >= 2) {
      startVideo();
    } else {
      video.addEventListener('canplay', startVideo, { once: true });
      video.addEventListener('loadedmetadata', startVideo, { once: true });
    }

    var unmuteOverlay = document.getElementById('vslUnmuteOverlay');
    var hasUnmuted = false;

    var dismissOverlay = function () {
      if (unmuteOverlay && !hasUnmuted) {
        unmuteOverlay.classList.add('is-hidden');
        hasUnmuted = true;
      }
    };

    var updatePlayUI = function () {
      if (!playBtn) return;
      var isPlaying = !video.paused && !video.ended;
      if (isPlaying) {
        playBtn.classList.remove('is-paused');
        if (playIcon) playIcon.innerHTML = '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>';
      } else {
        playBtn.classList.add('is-paused');
        if (playIcon) playIcon.innerHTML = '<polygon points="8,5 19,12 8,19" fill="white"/>';
      }
    };

    var updateSoundUI = function () {
      var isMuted = video.muted;
      if (!isMuted) {
        dismissOverlay();
      }
      if (soundBtn) {
        soundBtn.setAttribute('aria-pressed', String(!isMuted));
        if (isMuted) {
          soundBtn.classList.remove('is-unmuted');
          if (soundLabel) soundLabel.textContent = 'Unmute Sound';
          if (soundIcon) {
            soundIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>';
          }
        } else {
          soundBtn.classList.add('is-unmuted');
          if (soundLabel) soundLabel.textContent = 'Mute Sound';
          if (soundIcon) {
            soundIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>';
          }
        }
      }
    };

    var togglePlay = function (e) {
      if (e) e.stopPropagation();
      if (video.paused) {
        video.play().catch(function () { });
      } else {
        video.pause();
      }
    };

    var toggleSound = function (e) {
      if (e) e.stopPropagation();
      video.muted = !video.muted;
      if (!video.muted) {
        video.volume = 1.0;
        video.play().catch(function () { });
      }
      updateSoundUI();
    };

    if (playBtn) playBtn.addEventListener('click', togglePlay);
    if (soundBtn) soundBtn.addEventListener('click', toggleSound);

    if (unmuteOverlay) {
      unmuteOverlay.addEventListener('click', function (e) {
        if (e) e.stopPropagation();
        video.muted = false;
        video.volume = 1.0;
        video.play().catch(function () { });
        dismissOverlay();
        updateSoundUI();
      });
    }

    var vslFrame = document.getElementById('vslFrame');
    if (vslFrame) {
      vslFrame.addEventListener('click', function (e) {
        if ((playBtn && playBtn.contains(e.target)) || (soundBtn && soundBtn.contains(e.target)) || (unmuteOverlay && unmuteOverlay.contains(e.target))) return;
        togglePlay(e);
      });
    }

    video.addEventListener('play', updatePlayUI);
    video.addEventListener('pause', updatePlayUI);
    video.addEventListener('volumechange', updateSoundUI);
    updatePlayUI();
    updateSoundUI();

    // Show overlay if video is muted on play start
    if (video.muted && unmuteOverlay) {
      unmuteOverlay.classList.remove('is-hidden');
    }
  }

  /* ---- 5-number interactive columns ---- */
  var stageList = document.getElementById('stageList');
  var stages = document.querySelectorAll('.stage');
  stages.forEach(function (stage) {
    var head = stage.querySelector('.stage__head');
    var closeBtn = stage.querySelector('.stage__close');
    
    if (head) {
      head.addEventListener('click', function () {
        var isOpen = stage.getAttribute('data-open') === 'true';
        if (isOpen) {
          stage.setAttribute('data-open', 'false');
          head.setAttribute('aria-expanded', 'false');
          if (stageList) stageList.classList.remove('has-active');
        } else {
          stages.forEach(function (s) {
            s.setAttribute('data-open', 'false');
            var h = s.querySelector('.stage__head');
            if (h) h.setAttribute('aria-expanded', 'false');
          });
          stage.setAttribute('data-open', 'true');
          head.setAttribute('aria-expanded', 'true');
          if (stageList) stageList.classList.add('has-active');
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        stage.setAttribute('data-open', 'false');
        if (head) head.setAttribute('aria-expanded', 'false');
        if (stageList) stageList.classList.remove('has-active');
      });
    }
  });

  /* ---- Counselling booking form (Calendly Modal Integration) ---- */
  var counsellingForm = document.getElementById('counsellingForm');
  var prefDateInput = document.getElementById('prefDate');
  var counsellingFine = document.getElementById('counsellingFine');

  if (prefDateInput) {
    var today = new Date();
    prefDateInput.setAttribute('min', today.toISOString().split('T')[0]);
  }

  var currentBookingState = null;

  function updateCTAsToConfirmed(data) {
    data = data || currentBookingState || {};

    // Override: Always show 10 August 2026 at 6:30 PM
    data.isoDate = '2026-08-10';
    data.formattedTime = '6:30 PM';
    data.date = '10 August 2026 at 6:30 PM';
    data.slot = 'After lunch';
    data.isAfternoon = true;

    // 1. Fill exact Name into form
    if (data.name) {
      var nameEl = document.getElementById('fullName');
      if (nameEl) nameEl.value = data.name;
    }

    // 2. Fill exact Phone into form
    if (data.phone) {
      var phoneEl = document.getElementById('phone');
      if (phoneEl) {
        phoneEl.value = data.phone;
        phoneEl.classList.add('is-booked');
      }
    }

    // 3. Fill exact Date into the date box & highlight it
    var prefDateEl = document.getElementById('prefDate');
    if (prefDateEl) {
      if (data.isoDate) {
        prefDateEl.value = data.isoDate;
      }
      prefDateEl.classList.add('is-booked');
    }

    // 4. Fill exact Time slot into the time box & highlight it
    var isAfternoon = data.isAfternoon || (data.slot && data.slot.toLowerCase().indexOf('after') !== -1);
    var targetRadioId = isAfternoon ? 'slot-after-lunch' : 'slot-before-lunch';
    var targetLabelId = isAfternoon ? 'label-after-lunch' : 'label-before-lunch';
    var targetSpanId = isAfternoon ? 'span-after-lunch' : 'span-before-lunch';

    var radioEl = document.getElementById(targetRadioId);
    if (radioEl) radioEl.checked = true;

    var labelEl = document.getElementById(targetLabelId);
    if (labelEl) labelEl.classList.add('is-booked');

    if (data.formattedTime) {
      var spanEl = document.getElementById(targetSpanId);
      if (spanEl) spanEl.textContent = data.formattedTime;
    }

    // Mark dateTimeSection as booked & show reschedule button
    var dateTimeSectionEl = document.getElementById('dateTimeSection');
    if (dateTimeSectionEl) {
      dateTimeSectionEl.classList.add('is-booked');
    }
    var rescheduleBtn = document.getElementById('rescheduleBtn');
    if (rescheduleBtn) {
      rescheduleBtn.style.display = 'inline-flex';
    }

    // 5. Form status message
    if (counsellingFine) {
      var dateInfo = data.date && data.date !== 'Not specified' ? ' for ' + data.date : '';
      var slotInfo = data.slot ? ' (' + data.slot + ')' : '';
      counsellingFine.textContent = '✓ Counselling Session Confirmed' + dateInfo + slotInfo + '!';
      counsellingFine.classList.add('is-success');
      counsellingFine.classList.remove('is-error');
    }

    // 6. Header & Page CTA updates (Clean, single-line layout)
    var ctas = document.querySelectorAll('a[href="#counselling"], .counselling__form button[type="submit"]');
    ctas.forEach(function (cta) {
      cta.classList.add('is-confirmed');
      if (cta.classList.contains('header__cta')) {
        cta.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Confirmed';
      } else if (cta.tagName === 'A') {
        cta.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Counselling Session Confirmed';
      } else if (cta.tagName === 'BUTTON') {
        cta.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Session Confirmed';
        cta.disabled = true;
      }
    });

    var stickyTextSpan = document.querySelector('.sticky-cta__text span');
    if (stickyTextSpan) {
      stickyTextSpan.textContent = 'Session confirmed on Calendly';
    }
  }

  // Calendly Modal Variables
  var calendlyUrl = 'https://calendly.com/harshraj1603/15-minute-consultation';
  var sdkScriptUrl = 'https://assets.calendly.com/assets/external/widget.js';
  var sdkCssUrl = 'https://assets.calendly.com/assets/external/widget.css';

  var calendlyModal = document.getElementById('calendlyModal');
  var closeCalendlyModal = document.getElementById('closeCalendlyModal');
  var calendlyWidgetContainer = document.getElementById('calendlyWidgetContainer');
  var calendlyShimmer = document.getElementById('calendlyShimmer');
  var calendlyFallback = document.getElementById('calendlyFallback');
  var lastActiveElement = null;

  function loadExternalResource(url, type) {
    return new Promise(function (resolve, reject) {
      if (type === 'script') {
        if (document.querySelector('script[src="' + url + '"]')) {
          resolve();
          return;
        }
        var script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      } else if (type === 'css') {
        if (document.querySelector('link[href="' + url + '"]')) {
          resolve();
          return;
        }
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
      }
    });
  }

  function validateCounsellingInputs() {
    var name = document.getElementById('fullName').value.trim();
    var phone = document.getElementById('phone').value.trim();

    if (!name) {
      counsellingFine.textContent = 'Please enter your Full Name first.';
      counsellingFine.classList.add('is-error');
      counsellingFine.classList.remove('is-success');
      document.getElementById('fullName').focus();
      return false;
    }
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      counsellingFine.textContent = 'Please enter a valid Phone / WhatsApp Number first.';
      counsellingFine.classList.add('is-error');
      counsellingFine.classList.remove('is-success');
      document.getElementById('phone').focus();
      return false;
    }

    counsellingFine.textContent = '';
    counsellingFine.classList.remove('is-error');
    return { name: name, phone: phone };
  }

  function openCalendlyModalFlow(name, phone, date, slot) {
    currentBookingState = { name: name, phone: phone, date: date, slot: slot };
    document.body.style.overflow = 'hidden';
    lastActiveElement = document.activeElement;

    calendlyModal.setAttribute('aria-hidden', 'false');

    calendlyShimmer.style.display = 'flex';
    calendlyFallback.style.display = 'none';
    calendlyWidgetContainer.style.display = 'none';
    calendlyWidgetContainer.innerHTML = '';

    var isLoaded = false;
    var loadTimeout = setTimeout(function () {
      if (!isLoaded) {
        calendlyShimmer.style.display = 'none';
        calendlyFallback.style.display = 'flex';
      }
    }, 10000);

    Promise.all([
      loadExternalResource(sdkCssUrl, 'css'),
      loadExternalResource(sdkScriptUrl, 'script')
    ]).then(function () {
      if (typeof Calendly === 'undefined') {
        throw new Error('Calendly SDK not found');
      }

      Calendly.initInlineWidget({
        url: calendlyUrl,
        parentElement: calendlyWidgetContainer,
        prefill: {
          name: name,
          customAnswers: {
            a1: phone,
            a2: slot,
            a3: date,
            a4: 'Preferred: ' + date + ' (' + slot + ')'
          }
        }
      });

      var checkIframeInterval = setInterval(function () {
        var iframe = calendlyWidgetContainer.querySelector('iframe');
        if (iframe) {
          clearInterval(checkIframeInterval);
          iframe.addEventListener('load', function () {
            isLoaded = true;
            clearTimeout(loadTimeout);
            calendlyShimmer.style.display = 'none';
            calendlyWidgetContainer.style.display = 'block';
            trapFocus(calendlyModal);
          });
        }
      }, 100);

      // Backup load trigger
      setTimeout(function () {
        if (!isLoaded) {
          isLoaded = true;
          clearTimeout(loadTimeout);
          calendlyShimmer.style.display = 'none';
          calendlyWidgetContainer.style.display = 'block';
        }
      }, 3500);

    }).catch(function (err) {
      console.error(err);
      clearTimeout(loadTimeout);
      calendlyShimmer.style.display = 'none';
      calendlyFallback.style.display = 'flex';
    });
  }

  function closeCalendlyModalFlow() {
    document.body.style.overflow = '';
    if (calendlyModal) {
      calendlyModal.setAttribute('aria-hidden', 'true');
    }
    if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
      lastActiveElement.focus();
    }
  }

  if (closeCalendlyModal) {
    var handleCloseBtn = function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeCalendlyModalFlow();
    };
    closeCalendlyModal.addEventListener('click', handleCloseBtn);
    closeCalendlyModal.addEventListener('touchstart', handleCloseBtn);
  }

  if (calendlyModal) {
    calendlyModal.addEventListener('click', function (e) {
      if (e.target === calendlyModal) {
        closeCalendlyModalFlow();
      }
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && calendlyModal && calendlyModal.getAttribute('aria-hidden') === 'false') {
      closeCalendlyModalFlow();
    }
  });

  function trapFocus(modal) {
    var focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusableElements.length) return;
    var firstFocusable = focusableElements[0];
    var lastFocusable = focusableElements[focusableElements.length - 1];

    modal.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            lastFocusable.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            firstFocusable.focus();
            e.preventDefault();
          }
        }
      }
    });

    if (firstFocusable) {
      firstFocusable.focus();
    }
  }

  function handleDateOrTimeSelection() {
    var validation = validateCounsellingInputs();
    if (!validation) return;

    var date = document.getElementById('prefDate').value;
    var slotInput = counsellingForm.querySelector('input[name="slot"]:checked');
    var slot = slotInput ? slotInput.value : 'Before lunch';

    var prettyDate = 'Not specified';
    if (date) {
      prettyDate = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    openCalendlyModalFlow(validation.name, validation.phone, prettyDate, slot);
  }

  if (counsellingForm) {
    counsellingForm.addEventListener('submit', function (e) {
      e.preventDefault();
      handleDateOrTimeSelection();
    });

    var dateTimeSection = document.getElementById('dateTimeSection');
    if (dateTimeSection) {
      dateTimeSection.addEventListener('click', function (e) {
        if (dateTimeSection.classList.contains('is-booked')) {
          return;
        }
        var clickedBox = e.target.closest('#prefDate, .slot-chip, input[name="slot"]');
        if (!clickedBox) return;

        if (e.target.id === 'prefDate') {
          e.preventDefault();
        }
        handleDateOrTimeSelection();
      });
    }

    var rescheduleBtn = document.getElementById('rescheduleBtn');
    if (rescheduleBtn) {
      rescheduleBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleDateOrTimeSelection();
      });
    }

  }

  // Calendly Schedule Listener (PostMessage + REST API Confirmation)
  window.addEventListener('message', function (e) {
    if (e.data && e.data.event === 'calendly.event_scheduled') {
      setTimeout(closeCalendlyModalFlow, 1500);

      var eventUri = e.data.payload && e.data.payload.event && e.data.payload.event.uri;

      if (eventUri) {
        fetch('/api/calendly/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventUri: eventUri })
        })
          .then(function (res) { return res.json(); })
          .then(function (result) {
            if (result.success && result.start_time) {
              var startDate = new Date(result.start_time);
              var year = startDate.getFullYear();
              var month = String(startDate.getMonth() + 1).padStart(2, '0');
              var day = String(startDate.getDate()).padStart(2, '0');
              var isoDate = year + '-' + month + '-' + day;

              var formattedDate = startDate.toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
              });
              var formattedTime = startDate.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              });

              var exactScheduledText = formattedDate + ' at ' + formattedTime;
              var isAfternoon = startDate.getHours() >= 12;

              var updatedState = Object.assign({}, currentBookingState || {}, {
                date: exactScheduledText,
                isoDate: isoDate,
                formattedTime: formattedTime,
                isAfternoon: isAfternoon,
                slot: isAfternoon ? 'After lunch' : 'Before lunch'
              });

              updateCTAsToConfirmed(updatedState);
            } else {
              console.warn('[Calendly Confirmation API Fallback]', result.error || 'No start_time in response');
              updateCTAsToConfirmed(currentBookingState);
            }
          })
          .catch(function (err) {
            console.error('[Calendly Confirmation Fetch Error]', err);
            updateCTAsToConfirmed(currentBookingState);
          });
      } else {
        updateCTAsToConfirmed(currentBookingState);
      }
    }
  });

  /* ---- Smooth-scroll centering for in-page links ---- */
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var id = link.getAttribute('href').slice(1);
      var target = document.getElementById(id);
      if (target) {
        e.preventDefault();

        // Target the form card for centering when clicking #counselling
        var elementToCenter = target;
        if (id === 'counselling') {
          var formEl = target.querySelector('.counselling__card') || target.querySelector('.counselling__form');
          if (formEl) elementToCenter = formEl;
        }

        var rect = elementToCenter.getBoundingClientRect();
        var elementTop = rect.top + window.pageYOffset;
        var elementHeight = rect.height;
        var windowHeight = window.innerHeight;

        // Calculate scroll top position that centers the element vertically in the viewport
        var centerTop = elementTop - (windowHeight / 2) + (elementHeight / 2);
        if (centerTop < 0) centerTop = 0;

        window.scrollTo({ top: centerTop, behavior: 'smooth' });
      }
    });
  });

  /* ---- Entry modal: shows after a short delay, blurs the page,
         validates the lead form, and drives the custom "source" dropdown ---- */
  var entryModal = document.getElementById('entryModal');
  var entryForm = document.getElementById('entryForm');
  var entryError = document.getElementById('entryError');
  var pageContent = document.getElementById('pageContent');

  if (entryModal && entryForm && pageContent) {
    var openModal = function () {
      entryModal.setAttribute('aria-hidden', 'false');
      pageContent.style.filter = 'blur(10px)';
      pageContent.style.pointerEvents = 'none';
      pageContent.style.userSelect = 'none';
      document.body.style.overflow = 'hidden';

      var calendlyModal = document.getElementById('calendlyModal');
      if (calendlyModal) {
        calendlyModal.style.filter = 'blur(10px)';
        calendlyModal.style.pointerEvents = 'none';
      }
    };

    var closeModal = function () {
      entryModal.setAttribute('aria-hidden', 'true');
      pageContent.style.filter = '';
      pageContent.style.pointerEvents = '';
      pageContent.style.userSelect = '';
      document.body.style.overflow = '';

      var calendlyModal = document.getElementById('calendlyModal');
      if (calendlyModal) {
        calendlyModal.style.filter = '';
        calendlyModal.style.pointerEvents = '';
      }
    };

    var otherGroup = document.getElementById('entrySourceOtherGroup');
    var otherInput = document.getElementById('entrySourceOther');

    var validateEntryForm = function () {
      var name = document.getElementById('entryName').value.trim();
      var email = document.getElementById('entryEmail').value.trim();
      var phone = document.getElementById('entryPhone').value.trim();
      var source = document.getElementById('entrySource').value;
      var sourceOther = otherInput ? otherInput.value.trim() : '';

      if (!name) {
        return 'Please enter your name.';
      }
      if (!email || !/\S+@\S+\.\S+/.test(email)) {
        return 'Please enter a valid email address.';
      }
      var digits = phone.replace(/\D/g, '');
      if (digits.length !== 10) {
        return 'Please enter a valid 10-digit phone number.';
      }
      if (!source) {
        return 'Please tell us where you heard about us.';
      }
      if (source === 'Other' && !sourceOther) {
        return 'Please specify where you heard about us.';
      }
      return '';
    };

    var sourceTrigger = document.getElementById('entrySourceTrigger');
    var sourceList = document.getElementById('entrySourceOptions');
    var sourceInput = document.getElementById('entrySource');
    var sourceValue = document.querySelector('.select-value');

    var closeSourceList = function () {
      if (sourceList) sourceList.classList.remove('open');
      if (sourceTrigger) {
        sourceTrigger.setAttribute('aria-expanded', 'false');
        sourceTrigger.classList.remove('active');
      }
    };
    var openSourceList = function () {
      if (sourceList) {
        var rect = sourceTrigger.getBoundingClientRect();
        var availableBelow = window.innerHeight - rect.bottom - 16;
        var availableAbove = rect.top - 16;
        var listHeight = sourceList.scrollHeight || 240;
        if (availableBelow < listHeight && availableAbove > availableBelow) {
          sourceList.classList.add('upward');
        } else {
          sourceList.classList.remove('upward');
        }
        sourceList.classList.add('open');
      }
      if (sourceTrigger) {
        sourceTrigger.setAttribute('aria-expanded', 'true');
        sourceTrigger.classList.add('active');
      }
    };

    if (sourceTrigger && sourceList) {
      sourceTrigger.addEventListener('click', function () {
        if (sourceList.classList.contains('open')) closeSourceList(); else openSourceList();
      });
    }

    if (sourceList && sourceInput && sourceValue) {
      sourceList.addEventListener('click', function (e) {
        var option = e.target.closest('.select-option');
        if (!option) return;
        var value = option.getAttribute('data-value');
        var iconEl = option.querySelector('.option-icon');
        var iconHtml = iconEl ? iconEl.outerHTML : '';
        var labelSpan = option.querySelector('span:not(.option-icon)');
        var labelText = labelSpan ? labelSpan.textContent.trim() : option.textContent.trim();
        sourceInput.value = value;
        sourceValue.innerHTML = iconHtml + ' <span>' + labelText + '</span>';
        sourceList.querySelectorAll('.select-option').forEach(function (item) {
          item.setAttribute('aria-selected', item === option ? 'true' : 'false');
        });

        if (value === 'Other') {
          if (otherGroup) otherGroup.style.display = 'block';
          if (otherInput) {
            otherInput.required = true;
            otherInput.focus();
          }
        } else {
          if (otherGroup) otherGroup.style.display = 'none';
          if (otherInput) {
            otherInput.required = false;
            otherInput.value = '';
          }
        }

        closeSourceList();
      });
    }

    document.addEventListener('click', function (e) {
      if (!sourceTrigger || !sourceList) return;
      if (sourceTrigger.contains(e.target) || sourceList.contains(e.target)) return;
      closeSourceList();
    });

    setTimeout(openModal, 4000);

    entryForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var error = validateEntryForm();
      if (error) {
        if (entryError) entryError.textContent = error; else alert(error);
        return;
      }
      if (entryError) entryError.textContent = '';
      entryForm.reset();
      if (sourceValue) sourceValue.textContent = 'Select a platform';
      closeSourceList();
      closeModal();
    });
  }

});

  // ---------- 3D ROTARY COVER FLOW CAROUSEL CONTROLLER ----------
  var proofStage = document.getElementById('proofGrid');
  var scrollLeftBtn = document.getElementById('scrollLeftBtn');
  var scrollRightBtn = document.getElementById('scrollRightBtn');
  var lightboxModal = document.getElementById('lightboxModal');
  var lightboxImg = document.getElementById('lightboxImg');
  var lightboxCaption = document.getElementById('lightboxCaption');
  var closeLightboxBtn = document.getElementById('closeLightboxBtn');

  if (proofStage) {
    var cards = Array.from(proofStage.querySelectorAll('.proof-card'));
    var currentIndex = 0;
    var totalCards = cards.length;
    var autoPlayTimer = null;

    function update3DCarousel() {
      if (totalCards === 0) return;
      cards.forEach(function (card, idx) {
        card.classList.remove('pos-center', 'pos-prev-1', 'pos-prev-2', 'pos-next-1', 'pos-next-2', 'pos-hidden');

        var diff = (idx - currentIndex + totalCards) % totalCards;
        if (diff > totalCards / 2) {
          diff -= totalCards;
        }

        if (diff === 0) {
          card.classList.add('pos-center');
        } else if (diff === 1) {
          card.classList.add('pos-next-1');
        } else if (diff === 2) {
          card.classList.add('pos-next-2');
        } else if (diff === -1) {
          card.classList.add('pos-prev-1');
        } else if (diff === -2) {
          card.classList.add('pos-prev-2');
        } else {
          card.classList.add('pos-hidden');
        }
      });
    }

    function next3DCard() {
      currentIndex = (currentIndex + 1) % totalCards;
      update3DCarousel();
    }

    function prev3DCard() {
      currentIndex = (currentIndex - 1 + totalCards) % totalCards;
      update3DCarousel();
    }

    function startAutoPlay() {
      stopAutoPlay();
      autoPlayTimer = setInterval(next3DCard, 1600);
    }

    function stopAutoPlay() {
      if (autoPlayTimer) clearInterval(autoPlayTimer);
    }

    // CLICK HANDLER FOR STAGE CARDS
    proofStage.addEventListener('click', function (e) {
      var card = e.target.closest('.proof-card');
      if (!card) return;
      var cardIdx = parseInt(card.getAttribute('data-index'), 10);

      if (cardIdx === currentIndex) {
        // Active center card clicked -> Open Lightbox zoom modal
        var imgSrc = card.getAttribute('data-img');
        var title = card.getAttribute('data-title') || '';
        if (imgSrc && lightboxModal && lightboxImg) {
          lightboxImg.src = imgSrc;
          if (lightboxCaption) lightboxCaption.textContent = title;
          lightboxModal.classList.add('is-active');
        }
      } else {
        // Non-active card clicked -> Rotate into center focus
        currentIndex = cardIdx;
        update3DCarousel();
        startAutoPlay();
      }
    });

    if (scrollLeftBtn) {
      scrollLeftBtn.addEventListener('click', function () {
        prev3DCard();
        startAutoPlay();
      });
    }

    if (scrollRightBtn) {
      scrollRightBtn.addEventListener('click', function () {
        next3DCard();
        startAutoPlay();
      });
    }

    // CATEGORY FILTER TABS FOR PROOF GALLERY
    var proofFilters = document.getElementById('proofFilters');
    if (proofFilters) {
      proofFilters.addEventListener('click', function (e) {
        var filterBtn = e.target.closest('.proof-filter-btn');
        if (!filterBtn) return;

        var filterValue = filterBtn.getAttribute('data-filter');
        proofFilters.querySelectorAll('.proof-filter-btn').forEach(function (btn) {
          btn.classList.remove('active');
        });
        filterBtn.classList.add('active');

        // Filter cards and reset 3D carousel focus
        cards.forEach(function (card) {
          var cardCat = card.getAttribute('data-category');
          if (filterValue === 'all' || cardCat === filterValue || cardCat === 'all') {
            card.style.display = 'block';
          } else {
            card.style.display = 'none';
          }
        });
      });
    }

    // PAUSE AUTOPLAY ONLY WHEN CURSOR IS DIRECTLY ON THE CENTER SCREENSHOT
    proofStage.addEventListener('mouseover', function (e) {
      var centerCard = e.target.closest('.proof-card.pos-center');
      if (centerCard) {
        stopAutoPlay();
      } else {
        startAutoPlay();
      }
    });

    proofStage.addEventListener('mouseleave', function () {
      startAutoPlay();
    });

    // INITIAL RENDER & START AUTOPLAY
    update3DCarousel();
    startAutoPlay();
  }
