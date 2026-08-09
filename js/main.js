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

  // --- API URL HELPER ---
  function getApiUrl(endpoint) {
    if (window.location.protocol === 'file:' || (window.location.port && window.location.port !== '3000')) {
      return 'http://localhost:3000' + endpoint;
    }
    return endpoint;
  }

  // --- AVAILABILITY CHECK ---
  var counsellorUrls = {};
  var fetchedTimeSlots = [];
  var selectedCounsellorUrl = '';
  var selectedCounsellorId = 'counsellor1';
  var primaryCounsellorScope = 'counsellor1';

  function getBrowserTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (err) {
      return 'UTC';
    }
  }

  function getBrowserOffset() {
    var minutes = -new Date().getTimezoneOffset();
    var sign = minutes >= 0 ? '+' : '-';
    var abs = Math.abs(minutes);
    var hh = String(Math.floor(abs / 60)).padStart(2, '0');
    var mm = String(abs % 60).padStart(2, '0');
    return sign + hh + ':' + mm;
  }

  function postJson(url, payload) {
    return fetch(getApiUrl(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    });
  }

  function checkAvailability() {
    if (!prefDateInput) return;
    var date = prefDateInput.value;
    if (!date) return;

    var container = document.getElementById('timeSlotsContainer');
    if (container) {
      container.innerHTML = '<div class="time-slots-placeholder">Checking available timings...</div>';
    }

    if (counsellingFine) {
      counsellingFine.textContent = 'Checking slot availability...';
      counsellingFine.classList.remove('is-error', 'is-success');
    }

    var tz = encodeURIComponent(getBrowserTimezone());
    var tzOffset = encodeURIComponent(getBrowserOffset());
    var apiUrl = getApiUrl('/api/calendly/availability?date=' + encodeURIComponent(date) + '&refresh=true&counsellor=' + primaryCounsellorScope + '&tz=' + tz + '&tzOffset=' + tzOffset);
    fetch(apiUrl)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) {
          if (data.urls) {
            counsellorUrls['counsellor1'] = data.urls.counsellor1 || '';
            counsellorUrls['counsellor2'] = data.urls.counsellor2 || '';
          }
          fetchedTimeSlots = data.timeSlots || [];

          renderTimeSlots(fetchedTimeSlots, data.nextAvailable);
        } else {
          renderTimeSlots([], null);
        }
      })
      .catch(function (err) {
        console.error('[Availability Check Error]', err);
        renderTimeSlots([], null);
      });
  }

  function renderTimeSlots(slots, nextAvailable) {
    var container = document.getElementById('timeSlotsContainer');
    if (!container) return;

    container.innerHTML = '';
    selectedCounsellorUrl = '';
    selectedCounsellorId = 'counsellor1';

    if (!slots || slots.length === 0) {
      var msgHtml = '<div class="time-slots-placeholder" style="width:100%;">';
      msgHtml += '<p style="margin:0 0 10px; font-weight:600; color:#dc2626;">No available slots on the selected date.</p>';
      if (nextAvailable && nextAvailable.date) {
        msgHtml += '<button type="button" id="jumpNextDateBtn" style="background:#BF1D4B; color:#ffffff; border:none; padding:10px 18px; border-radius:8px; font-weight:700; font-size:13px; cursor:pointer; box-shadow:0 4px 12px rgba(191,29,75,0.25); transition:all 0.2s ease;">';
        msgHtml += '📅 Switch to Next Available Date: <strong>' + (nextAvailable.formattedDate || nextAvailable.date) + '</strong> (' + nextAvailable.count + ' slots open)';
        msgHtml += '</button>';
      } else {
        msgHtml += '<span style="color:#94a3b8; font-size:13px;">Please select another date in the calendar.</span>';
      }
      msgHtml += '</div>';
      container.innerHTML = msgHtml;

      if (counsellingFine) {
        counsellingFine.textContent = nextAvailable ? ('No slots on this date. Next available date is ' + (nextAvailable.formattedDate || nextAvailable.date)) : 'No available counselling slots on this date. Please select another date.';
        counsellingFine.classList.add('is-error');
        counsellingFine.classList.remove('is-success');
      }

      var jumpBtn = document.getElementById('jumpNextDateBtn');
      if (jumpBtn && nextAvailable) {
        jumpBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (window.selectDateAndCheck) {
            window.selectDateAndCheck(nextAvailable.date);
          }
        });
      }
      return;
    }

    if (counsellingFine) {
      counsellingFine.textContent = 'Slots available! Please select a preferred time slot below.';
      counsellingFine.classList.add('is-success');
      counsellingFine.classList.remove('is-error');
    }

    var categories = {
      'Morning': [],
      'Afternoon': [],
      'Evening': []
    };

    slots.forEach(function (slot) {
      var h = slot.localHour !== undefined ? slot.localHour : 12;
      if (h < 12) {
        categories['Morning'].push(slot);
      } else if (h >= 12 && h < 17) {
        categories['Afternoon'].push(slot);
      } else {
        categories['Evening'].push(slot);
      }
    });

    var globalIndex = 0;
    var firstRadioChecked = false;

    Object.keys(categories).forEach(function (catName) {
      var catSlots = categories[catName];
      if (catSlots.length === 0) return;

      var groupEl = document.createElement('div');
      groupEl.className = 'time-slots-group';

      var titleEl = document.createElement('div');
      titleEl.className = 'time-group-title';
      titleEl.textContent = catName;
      groupEl.appendChild(titleEl);

      var gridEl = document.createElement('div');
      gridEl.className = 'time-chips-grid';

      catSlots.forEach(function (slot) {
        var wrapper = document.createElement('div');
        wrapper.className = 'time-chip-wrapper';

        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'slot';
        radio.id = 'slot-' + globalIndex;
        radio.value = slot.time;
        if (!firstRadioChecked) {
          radio.checked = true;
          firstRadioChecked = true;
          var firstCounsellor = slot.counsellors[0] || 'counsellor1';
          selectedCounsellorId = firstCounsellor;
          selectedCounsellorUrl = slot.slotUrls[firstCounsellor] || counsellorUrls[firstCounsellor] || '';
        }

        var label = document.createElement('label');
        label.htmlFor = 'slot-' + globalIndex;
        label.className = 'time-chip';
        label.textContent = slot.time;

        (function (sObj, rObj) {
          label.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            rObj.checked = true;
            var counsellorId = sObj.counsellors[0] || 'counsellor1';
            selectedCounsellorId = counsellorId;
            selectedCounsellorUrl = sObj.slotUrls[counsellorId] || counsellorUrls[counsellorId] || '';
            handleDateOrTimeSelection();
          });
        })(slot, radio);

        wrapper.appendChild(radio);
        wrapper.appendChild(label);
        gridEl.appendChild(wrapper);

        globalIndex++;
      });

      groupEl.appendChild(gridEl);
      container.appendChild(groupEl);
    });
  }

  // --- CUSTOM CALENDAR PICKER & LIVE AVAILABILITY INTEGRATION ---
  var customDatePicker = document.getElementById('customDatePicker');
  var customDateTrigger = document.getElementById('customDateTrigger');
  var customDateText = document.getElementById('customDateText');
  var customCalendarPopover = document.getElementById('customCalendarPopover');
  var calMonthTitle = document.getElementById('calMonthTitle');
  var calDaysGrid = document.getElementById('calDaysGrid');
  var calPrevMonth = document.getElementById('calPrevMonth');
  var calNextMonth = document.getElementById('calNextMonth');
  var calCloseBtn = document.getElementById('calCloseBtn');
  var customCalendarOverlay = document.getElementById('customCalendarOverlay');

  var availableDateSet = new Set();
  var todayObj = new Date();
  var currentCalYear = todayObj.getFullYear();
  var currentCalMonth = todayObj.getMonth();
  var selectedDateStr = '';

  var monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function formatDisplayDate(dateStr) {
    if (!dateStr) return 'Select Preferred Date';
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fallbackWeekdayDates() {
    var dateSet = new Set();
    var now = new Date();
    for (var i = 0; i < 60; i++) {
      var d = new Date(now.getTime() + i * 86400000);
      var dayOfWeek = d.getDay();
      if (dayOfWeek !== 0) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        dateSet.add(y + '-' + m + '-' + day);
      }
    }
    availableDateSet = dateSet;
  }

  function fetchMonthAvailability(callback) {
    var tz = encodeURIComponent(getBrowserTimezone());
    var apiUrl = getApiUrl('/api/calendly/month-availability?refresh=true&counsellor=' + primaryCounsellorScope + '&tz=' + tz);
    fetch(apiUrl)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success && Array.isArray(data.availableDates) && data.availableDates.length > 0) {
          availableDateSet = new Set(data.availableDates);
        } else {
          fallbackWeekdayDates();
        }
        if (callback) callback();
      })
      .catch(function (err) {
        console.warn('[Month Availability Fetch Error]', err);
        fallbackWeekdayDates();
        if (callback) callback();
      });
  }

  function renderCalendarGrid(year, month) {
    if (!calMonthTitle || !calDaysGrid) return;

    calMonthTitle.textContent = monthNames[month] + ' ' + year;
    calDaysGrid.innerHTML = '';

    var firstDay = new Date(year, month, 1);
    var startingDayOfWeek = (firstDay.getDay() + 6) % 7;
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    for (var e = 0; e < startingDayOfWeek; e++) {
      var emptyCell = document.createElement('div');
      emptyCell.className = 'cal-day-cell empty';
      calDaysGrid.appendChild(emptyCell);
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var cell = document.createElement('div');
      cell.className = 'cal-day-cell';
      cell.textContent = day;

      var monthStr = String(month + 1).padStart(2, '0');
      var dayStr = String(day).padStart(2, '0');
      var fullDateStr = year + '-' + monthStr + '-' + dayStr;

      var isAvailable = availableDateSet.has(fullDateStr);
      var isPast = new Date(fullDateStr + 'T23:59:59') < new Date();

      if (isAvailable && !isPast) {
        cell.classList.add('is-available');
        (function (dStr) {
          cell.addEventListener('click', function (e) {
            e.stopPropagation();
            selectDate(dStr);
          });
        })(fullDateStr);
      } else {
        cell.classList.add('is-disabled');
      }

      if (fullDateStr === selectedDateStr) {
        cell.classList.add('is-selected');
      }

      calDaysGrid.appendChild(cell);
    }
  }

  function selectDate(dateStr) {
    selectedDateStr = dateStr;
    if (prefDateInput) {
      prefDateInput.value = dateStr;
    }
    if (customDateText) {
      customDateText.textContent = formatDisplayDate(dateStr);
    }
    if (customDatePicker) {
      customDatePicker.classList.remove('is-open');
    }
    renderCalendarGrid(currentCalYear, currentCalMonth);
    checkAvailability();
  }

  window.selectDateAndCheck = selectDate;

  // Calendar open/close handlers
  if (calCloseBtn) {
    calCloseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (customDatePicker) customDatePicker.classList.remove('is-open');
    });
  }

  if (customCalendarOverlay) {
    customCalendarOverlay.addEventListener('click', function (e) {
      e.stopPropagation();
      if (customDatePicker) customDatePicker.classList.remove('is-open');
    });
  }

  if (customDateTrigger) {
    customDateTrigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = customDatePicker.classList.contains('is-open');
      if (!isOpen) {
        customDatePicker.classList.add('is-open');
        fetchMonthAvailability(function () {
          renderCalendarGrid(currentCalYear, currentCalMonth);
        });
      } else {
        customDatePicker.classList.remove('is-open');
      }
    });

    document.addEventListener('click', function (e) {
      if (customDatePicker && !customDatePicker.contains(e.target)) {
        customDatePicker.classList.remove('is-open');
      }
    });
  }

  if (calPrevMonth) {
    calPrevMonth.addEventListener('click', function (e) {
      e.stopPropagation();
      currentCalMonth--;
      if (currentCalMonth < 0) {
        currentCalMonth = 11;
        currentCalYear--;
      }
      renderCalendarGrid(currentCalYear, currentCalMonth);
    });
  }

  if (calNextMonth) {
    calNextMonth.addEventListener('click', function (e) {
      e.stopPropagation();
      currentCalMonth++;
      if (currentCalMonth > 11) {
        currentCalMonth = 0;
        currentCalYear++;
      }
      renderCalendarGrid(currentCalYear, currentCalMonth);
    });
  }

  // Pre-fetch availability on load
  fetchMonthAvailability(function () {
    renderCalendarGrid(currentCalYear, currentCalMonth);
  });

  var currentBookingState = null;

  function updateCTAsToConfirmed(data) {
    data = data || currentBookingState || {};

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

    // Update customDateText to show the confirmed date & time
    var dateTextEl = document.getElementById('customDateText');
    if (dateTextEl && data.date) {
      dateTextEl.textContent = data.date;
    }

    // Render a single confirmed time slot chip in the container
    var container = document.getElementById('timeSlotsContainer');
    if (container && data.formattedTime) {
      container.innerHTML = `
        <div class="time-chip-wrapper">
          <input type="radio" name="slot" id="slot-confirmed" value="${data.slot || data.formattedTime}" checked disabled>
          <label for="slot-confirmed" class="time-chip is-confirmed" style="border-color: var(--brand-primary); background: var(--brand-light); color: var(--brand-primary-deep); font-weight: 700;">
            ✓ ${data.formattedTime}
          </label>
        </div>
      `;
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
      counsellingFine.textContent = '✓ Counselling Session Confirmed' + dateInfo + '!';
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

  var calendlyLoadPromise = null;

  function loadExternalResource(url, type) {
    if (type === 'script') {
      if (window.Calendly) {
        return Promise.resolve();
      }
      if (calendlyLoadPromise) {
        return calendlyLoadPromise;
      }
      calendlyLoadPromise = new Promise(function (resolve, reject) {
        if (document.querySelector('script[src="' + url + '"]')) {
          var checkInterval = setInterval(function () {
            if (window.Calendly) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 50);
          return;
        }
        var script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = function () {
          resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
      return calendlyLoadPromise;
    } else {
      return new Promise(function (resolve, reject) {
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
      });
    }
  }

  function validateCounsellingInputs() {
    var name = document.getElementById('fullName').value.trim();
    var countryCode = document.getElementById('countryCode').value;
    var rawPhone = document.getElementById('phone').value.trim();
    var phone = countryCode + ' ' + rawPhone;

    if (!name) {
      counsellingFine.textContent = 'Please enter your Full Name first.';
      counsellingFine.classList.add('is-error');
      counsellingFine.classList.remove('is-success');
      document.getElementById('fullName').focus();
      return false;
    }
    if (!rawPhone || rawPhone.replace(/\D/g, '').length < 8) {
      counsellingFine.textContent = 'Please enter a valid Phone / WhatsApp Number first.';
      counsellingFine.classList.add('is-error');
      counsellingFine.classList.remove('is-success');
      document.getElementById('phone').focus();
      return false;
    }

    counsellingFine.textContent = '';
    counsellingFine.classList.remove('is-error');
    return { name: name, phone: phone, countryCode: countryCode };
  }

  function openCalendlyModalFlow(name, phone, countryCode, date, slot, targetUrl, counsellorId) {
    currentBookingState = {
      name: name,
      phone: phone,
      countryCode: countryCode,
      date: date,
      slot: slot,
      selectedCounsellor: counsellorId || 'counsellor1',
      selectedCounsellorUrl: targetUrl || ''
    };
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

      var bookingUrl = targetUrl || calendlyUrl;
      Calendly.initInlineWidget({
        url: bookingUrl,
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
    if (!slotInput) {
      if (counsellingFine) {
        counsellingFine.textContent = 'Please select a preferred time slot first.';
        counsellingFine.classList.add('is-error');
        counsellingFine.classList.remove('is-success');
      }
      return;
    }
    var slot = slotInput.value;

    var prettyDate = 'Not specified';
    if (date) {
      prettyDate = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    var targetUrl = selectedCounsellorUrl || counsellorUrls['counsellor1'] || 'https://calendly.com/harshraj1603/15-minute-consultation';

    var savedLead = {};
    try {
      savedLead = JSON.parse(localStorage.getItem('amc_lead_user') || '{}');
    } catch (e) {}

    var counsellorName = (selectedCounsellorId === 'counsellor2' || selectedCounsellorId === 'aryan') ? 'Counsellor 2 (Aryan Raj)' : 'Counsellor 1 (starsamir9955)';

    postJson('/api/admin/bookings/intent', {
      name: validation.name,
      email: savedLead.email || null,
      phone: validation.phone,
      countryCode: validation.countryCode,
      source: savedLead.source || 'Website Form',
      sourceOther: savedLead.sourceOther || null,
      preferredDate: prettyDate,
      selectedSlot: slot,
      selectedCounsellor: counsellorName,
      selectedCounsellorId: selectedCounsellorId,
      selectedCounsellorUrl: targetUrl,
      timezone: getBrowserTimezone()
    }).then(function (resp) {
      if (resp.ok && resp.data && resp.data.bookingId) {
        currentBookingState = currentBookingState || {};
        currentBookingState.bookingId = resp.data.bookingId;
      }
    }).catch(function (err) {
      console.warn('[Booking Intent Save Warning]', err);
    });

    openCalendlyModalFlow(validation.name, validation.phone, validation.countryCode, prettyDate, slot, targetUrl, selectedCounsellorId);
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
        var clickedBox = e.target.closest('#prefDate');
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
          body: JSON.stringify({ eventUri: eventUri, counsellor: currentBookingState && currentBookingState.selectedCounsellor })
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

              postJson('/api/admin/bookings/confirm', {
                bookingId: updatedState.bookingId,
                calendlyEventUri: eventUri,
                calendlyEventName: result.name,
                scheduledStartTime: result.start_time,
                scheduledEndTime: result.end_time,
                status: result.status,
                notes: 'Confirmed from Calendly webhook event'
              }).catch(function (err) {
                console.warn('[Booking Confirm Save Warning]', err);
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
      var countryCode = document.getElementById('entryCountryCode').value.trim();
      var rawPhone = document.getElementById('entryPhone').value.trim();
      var source = document.getElementById('entrySource').value;
      var sourceOther = otherInput ? otherInput.value.trim() : '';

      if (!name) {
        return 'Please enter your name.';
      }
      if (!email || !/\S+@\S+\.\S+/.test(email)) {
        return 'Please enter a valid email address.';
      }
      var digits = rawPhone.replace(/\D/g, '');
      if (digits.length < 8) {
        return 'Please enter a valid phone number.';
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

      var leadPayload = {
        name: document.getElementById('entryName').value.trim(),
        email: document.getElementById('entryEmail').value.trim(),
        countryCode: document.getElementById('entryCountryCode').value.trim(),
        phone: document.getElementById('entryCountryCode').value.trim() + ' ' + document.getElementById('entryPhone').value.trim(),
        source: document.getElementById('entrySource').value,
        sourceOther: otherInput ? otherInput.value.trim() : ''
      };

      try {
        localStorage.setItem('amc_lead_user', JSON.stringify(leadPayload));
      } catch (e) {}

      // Pre-fill counselling form inputs
      var nameInput = document.getElementById('fullName');
      if (nameInput && !nameInput.value) nameInput.value = leadPayload.name;
      var phoneInput = document.getElementById('phone');
      if (phoneInput && !phoneInput.value) phoneInput.value = document.getElementById('entryPhone').value.trim();

      postJson('/api/admin/leads', leadPayload).catch(function (err) {
        console.warn('[Lead Save Warning]', err);
      });

      entryForm.reset();
      
      // Reset country code picker flags/codes to default
      var entryFlag = document.getElementById('entrySelectedCountryFlag');
      var entryCode = document.getElementById('entrySelectedCountryCode');
      var entryHidden = document.getElementById('entryCountryCode');
      if (entryFlag) entryFlag.innerHTML = '<img src="https://flagcdn.com/w20/in.png" width="18" style="border-radius:2px; box-shadow: 0 1px 2px rgba(0,0,0,0.15); display:inline-block; vertical-align:middle; margin-right:4px;" alt="India Flag">';
      if (entryCode) entryCode.textContent = '+91';
      if (entryHidden) entryHidden.value = '+91';

      if (sourceValue) sourceValue.innerHTML = '<span>Select a platform</span>';
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

    // CLOSE LIGHTBOX HANDLERS
    if (closeLightboxBtn && lightboxModal) {
      closeLightboxBtn.addEventListener('click', function () {
        lightboxModal.classList.remove('is-active');
      });
    }

    if (lightboxModal) {
      lightboxModal.addEventListener('click', function (e) {
        if (e.target === lightboxModal) {
          lightboxModal.classList.remove('is-active');
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lightboxModal && lightboxModal.classList.contains('is-active')) {
        lightboxModal.classList.remove('is-active');
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

  // --- SEARCHABLE COUNTRY CODE PICKERS ---
  function initCountryCodePicker(config) {
    var picker = document.getElementById(config.pickerId);
    var trigger = document.getElementById(config.triggerId);
    var dropdown = document.getElementById(config.dropdownId);
    var searchInput = document.getElementById(config.searchInputId);
    var list = document.getElementById(config.listId);
    var flagEl = document.getElementById(config.flagElId);
    var codeEl = document.getElementById(config.codeElId);
    var hiddenInput = document.getElementById(config.hiddenInputId);

    if (!picker || !trigger || !list) return;

    var countries = [
      { name: "Australia", code: "+61", iso: "au" },
      { name: "India", code: "+91", iso: "in" },
      { name: "United Kingdom", code: "+44", iso: "gb" },
      { name: "United States", code: "+1", iso: "us" },
      { name: "Canada", code: "+1", iso: "ca" },
      { name: "New Zealand", code: "+64", iso: "nz" },
      { name: "Ireland", code: "+353", iso: "ie" },
      { name: "South Africa", code: "+27", iso: "za" },
      { name: "Singapore", code: "+65", iso: "sg" },
      { name: "Malaysia", code: "+60", iso: "my" },
      { name: "United Arab Emirates", code: "+971", iso: "ae" },
      { name: "Saudi Arabia", code: "+966", iso: "sa" },
      { name: "Pakistan", code: "+92", iso: "pk" },
      { name: "Nepal", code: "+977", iso: "np" },
      { name: "Bangladesh", code: "+880", iso: "bd" },
      { name: "Sri Lanka", code: "+94", iso: "lk" }
    ];

    function renderList(filterText) {
      list.innerHTML = '';
      var query = (filterText || '').toLowerCase().trim();

      countries.forEach(function (c) {
        if (query && c.name.toLowerCase().indexOf(query) === -1 && c.code.indexOf(query) === -1) {
          return;
        }

        var li = document.createElement('li');
        li.className = 'country-option';
        li.innerHTML = `
          <div class="country-option__name-flag">
            <span class="country-option__flag"><img src="https://flagcdn.com/w20/${c.iso}.png" width="18" style="border-radius:1px; vertical-align:middle; display:inline-block;" alt="${c.name} Flag"></span>
            <span class="country-option__name">${c.name}</span>
          </div>
          <span class="country-option__code">${c.code}</span>
        `;

        li.addEventListener('click', function (e) {
          e.stopPropagation();
          flagEl.innerHTML = `<img src="https://flagcdn.com/w20/${c.iso}.png" width="18" style="border-radius:2px; box-shadow: 0 1px 2px rgba(0,0,0,0.15); display:inline-block; vertical-align:middle; margin-right:4px;" alt="${c.name} Flag">`;
          codeEl.textContent = c.code;
          hiddenInput.value = c.code;
          picker.classList.remove('is-open');
          if (searchInput) searchInput.value = '';
          renderList('');
        });

        list.appendChild(li);
      });
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = picker.classList.contains('is-open');
      if (isOpen) {
        picker.classList.remove('is-open');
      } else {
        // Close other open pickers
        document.querySelectorAll('.country-code-picker').forEach(function (p) {
          p.classList.remove('is-open');
        });
        picker.classList.add('is-open');
        setTimeout(function () {
          if (searchInput) searchInput.focus();
        }, 50);
      }
    });

    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        renderList(e.target.value);
      });
      searchInput.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    }

    document.addEventListener('click', function (e) {
      if (!picker.contains(e.target)) {
        picker.classList.remove('is-open');
      }
    });

    renderList('');
  }

  // Initialize main form country code picker
  initCountryCodePicker({
    pickerId: 'countryCodePicker',
    triggerId: 'countryCodeTrigger',
    dropdownId: 'countryCodeDropdown',
    searchInputId: 'countrySearchInput',
    listId: 'countryOptionsList',
    flagElId: 'selectedCountryFlag',
    codeElId: 'selectedCountryCode',
    hiddenInputId: 'countryCode'
  });

  // Initialize entry modal country code picker
  initCountryCodePicker({
    pickerId: 'entryCountryCodePicker',
    triggerId: 'entryCountryCodeTrigger',
    dropdownId: 'entryCountryCodeDropdown',
    searchInputId: 'entryCountrySearchInput',
    listId: 'entryCountryOptionsList',
    flagElId: 'entrySelectedCountryFlag',
    codeElId: 'entrySelectedCountryCode',
    hiddenInputId: 'entryCountryCode'
  });
