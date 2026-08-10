document.addEventListener('DOMContentLoaded', function () {

  /* ---- Page content & form inputs clean reset on fresh reload ---- */
  var pageContentEl = document.getElementById('pageContent');
  if (pageContentEl) {
    pageContentEl.style.filter = '';
    pageContentEl.style.pointerEvents = '';
    pageContentEl.style.userSelect = '';
  }
  document.body.style.overflow = '';

  try {
    localStorage.removeItem('amc_entry_submitted');
    localStorage.removeItem('amc_lead_submitted');
  } catch (e) {}

  var fnEl = document.getElementById('fullName');
  if (fnEl) fnEl.value = '';
  var phEl = document.getElementById('phone');
  if (phEl) phEl.value = '';
  var pdEl = document.getElementById('prefDate');
  if (pdEl) pdEl.value = '';
  var eN = document.getElementById('entryName');
  if (eN) eN.value = '';
  var eP = document.getElementById('entryPhone');
  if (eP) eP.value = '';
  var eE = document.getElementById('entryEmail');
  if (eE) eE.value = '';

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
  var primaryCounsellorScope = 'both';

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
            // Check this radio and uncheck others
            container.querySelectorAll('input[name="slot"]').forEach(function (r) {
              r.checked = (r === rObj);
            });
            rObj.checked = true;
            var counsellorId = (sObj.counsellors && sObj.counsellors[0]) || 'counsellor1';
            selectedCounsellorId = counsellorId;
            selectedCounsellorUrl = (sObj.slotUrls && sObj.slotUrls[counsellorId]) || counsellorUrls[counsellorId] || '';
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

    // Fallback values for instant UI response before server confirmation completes
    var rawSlot = data.slot || '';
    if (!data.formattedTime && rawSlot) {
      if (rawSlot.toLowerCase().indexOf('lunch') === -1) {
        data.formattedTime = rawSlot;
      } else {
        data.formattedTime = rawSlot.toLowerCase().indexOf('after') !== -1 ? 'Afternoon Session' : 'Morning Session';
      }
    }

    // If date is not in pretty format, try to format it or use a default
    var prettyDate = data.date || '';
    var dateInput = document.getElementById('prefDate');
    if (!prettyDate && dateInput && dateInput.value) {
      try {
        prettyDate = new Date(dateInput.value + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      } catch (e) {
        prettyDate = dateInput.value;
      }
    }
    if (prettyDate && prettyDate.indexOf('at') === -1 && data.formattedTime) {
      prettyDate = prettyDate + ' at ' + data.formattedTime;
    }
    data.date = prettyDate || data.date;

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

    // Mark dateTimeSection as booked
    var dateTimeSectionEl = document.getElementById('dateTimeSection');
    if (dateTimeSectionEl) {
      dateTimeSectionEl.classList.add('is-booked');
    }

    // 5. Form status message & prominent Success Card
    if (counsellingFine) {
      var dateInfo = data.date && data.date !== 'Not specified' ? ' for ' + data.date : '';
      counsellingFine.textContent = '✓ Counselling Session Confirmed' + dateInfo + '!';
      counsellingFine.classList.add('is-success');
      counsellingFine.classList.remove('is-error');
    }

    var existingSuccess = document.getElementById('bookingSuccessCard');
    if (!existingSuccess && counsellingForm) {
      var successCard = document.createElement('div');
      successCard.id = 'bookingSuccessCard';
      successCard.style.cssText = 'background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 20px 24px; border-radius: 12px; text-align: center; margin-bottom: 20px; box-shadow: 0 10px 25px rgba(16, 185, 129, 0.28); animation: fadeIn 0.4s ease;';
      var scheduledDateStr = data.date && data.date !== 'Not specified' ? data.date : 'your selected time';
      successCard.innerHTML = `
        <div style="font-size: 26px; margin-bottom: 4px;">🎉</div>
        <h3 style="color: white; font-size: 19px; font-weight: 800; margin-bottom: 4px; letter-spacing: -0.01em;">Counselling Session Booked!</h3>
        <p style="color: rgba(255,255,255,0.95); font-size: 14px; margin: 0; line-height: 1.4;">We look forward to meeting you on <strong>${scheduledDateStr}</strong>. A calendar invite and meeting details have been sent to you.</p>
      `;
      counsellingForm.prepend(successCard);
    }

    // 6. Header & Page CTA updates (Clean, single-line layout)
    var ctas = document.querySelectorAll('a[href="#counselling"], .counselling__form button[type="submit"]');
    ctas.forEach(function (cta) {
      cta.classList.add('is-confirmed');
      if (cta.classList.contains('header__cta')) {
        cta.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Booked';
      } else if (cta.tagName === 'A') {
        cta.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Counselling Session Booked';
      } else if (cta.tagName === 'BUTTON') {
        cta.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Session Booked';
        cta.disabled = true;
      }
    });

    var stickyTextSpan = document.querySelector('.sticky-cta__text span');
    if (stickyTextSpan) {
      stickyTextSpan.textContent = 'Session booked on Calendly';
    }

    // Scroll to the counselling card smoothly
    var cSection = document.getElementById('counselling');
    if (cSection) {
      var rect = cSection.getBoundingClientRect();
      var centerTop = rect.top + window.pageYOffset - (window.innerHeight / 2) + (rect.height / 2);
      window.scrollTo({ top: Math.max(0, centerTop), behavior: 'smooth' });
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
        script.type = 'text/javascript';
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      return calendlyLoadPromise;
    } else if (type === 'css') {
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
    var nameInput = document.getElementById('fullName');
    var rawPhoneInput = document.getElementById('phone');
    var countryCodeInput = document.getElementById('countryCode');

    var name = (nameInput ? nameInput.value : '').trim();
    var countryCode = countryCodeInput ? countryCodeInput.value : '+91';
    var rawPhone = (rawPhoneInput ? rawPhoneInput.value : '').trim();

    // Auto-fill from stored lead if inputs were empty
    if (!name || !rawPhone) {
      try {
        var stored = JSON.parse(sessionStorage.getItem('amc_lead_user') || localStorage.getItem('amc_lead_user') || 'null');
        if (stored) {
          if (!name && stored.name) {
            name = stored.name;
            if (nameInput) {
              nameInput.value = name;
              nameInput.setAttribute('value', name);
            }
          }
          if (!rawPhone && (stored.phoneOnly || stored.phone)) {
            rawPhone = stored.phoneOnly || String(stored.phone).replace(/^\+\d+\s*/, '').trim();
            if (rawPhoneInput) {
              rawPhoneInput.value = rawPhone;
              rawPhoneInput.setAttribute('value', rawPhone);
            }
          }
          if (stored.countryCode && countryCodeInput) {
            countryCode = stored.countryCode;
            countryCodeInput.value = countryCode;
          }
        }
      } catch (e) {}
    }

    if (!name) name = 'Student';
    if (!rawPhone) rawPhone = '';

    var phone = rawPhone ? (countryCode + ' ' + rawPhone) : '';

    if (counsellingFine) {
      counsellingFine.textContent = '';
      counsellingFine.classList.remove('is-error');
    }
    return { name: name, phone: phone, countryCode: countryCode };
  }

  var calendlyPollInterval = null;
  var hasHandledScheduledBooking = false;
  var calendlyOpenTimestamp = 0;

  function handleBookingCompleted(eventUri, eventDetails) {
    if (hasHandledScheduledBooking) return;
    hasHandledScheduledBooking = true;

    if (calendlyPollInterval) {
      clearInterval(calendlyPollInterval);
      calendlyPollInterval = null;
    }

    console.log('[Calendly Auto-Close] Booking confirmed. Updating UI instantly and showing confirmation animation...', eventUri, eventDetails);

    // Update UI instantly on the background page
    updateCTAsToConfirmed(currentBookingState || {});

    // Show beautiful animated confirmation overlay inside modal
    var confirmOverlay = document.getElementById('calendlyConfirmOverlay');
    if (confirmOverlay) {
      confirmOverlay.style.display = 'flex';
      var spinner = document.getElementById('confirmSpinnerIcon');
      if (spinner) spinner.classList.add('is-success');
      var progress = document.getElementById('confirmProgressFill');
      if (progress) progress.classList.add('is-done');
      var title = document.getElementById('confirmTitle');
      if (title) title.textContent = 'Session Booked Successfully! 🎉';
      var subtitle = document.getElementById('confirmSubtitle');
      if (subtitle) subtitle.textContent = 'Your appointment has been confirmed. Redirecting to your booking...';
    }

    // Show visual confirmation banner inside modal header
    var modalHeader = document.querySelector('.calendly-modal-header');
    if (modalHeader) {
      var oldBanner = modalHeader.querySelector('.calendly-success-banner');
      if (oldBanner) oldBanner.remove();

      var banner = document.createElement('div');
      banner.className = 'calendly-success-banner';
      banner.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Appointment Scheduled! Closing...</span>
      `;
      modalHeader.prepend(banner);
    }

    // 1. Close the modal after brief celebration animation
    setTimeout(function () {
      closeCalendlyModalFlow();
    }, 850);

    // 2. Fetch server-side verification and confirm booking record
    var targetUri = eventUri || (eventDetails && eventDetails.calendlyEventUri);
    if (targetUri) {
      fetch('/api/calendly/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventUri: targetUri, counsellor: currentBookingState && currentBookingState.selectedCounsellor })
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
              calendlyEventUri: targetUri,
              calendlyEventName: result.name,
              scheduledStartTime: result.start_time,
              scheduledEndTime: result.end_time,
              status: result.status,
              notes: 'Confirmed from Calendly webhook event'
            }).catch(function (err) {
              console.warn('[Booking Confirm Save Warning]', err);
            });

            updateCTAsToConfirmed(updatedState);
          }
        })
        .catch(function (err) {
          console.error('[Calendly Confirmation Fetch Error]', err);
        });
    } else if (eventDetails && eventDetails.scheduledStartTime) {
      var sDate = new Date(eventDetails.scheduledStartTime);
      var fDate = sDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      var fTime = sDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      var stateFromEvent = Object.assign({}, currentBookingState || {}, {
        date: fDate + ' at ' + fTime,
        formattedTime: fTime,
        slot: sDate.getHours() >= 12 ? 'After lunch' : 'Before lunch'
      });
      updateCTAsToConfirmed(stateFromEvent);
    }
  }

  function openCalendlyModalFlow(name, phone, countryCode, date, slot, targetUrl, counsellorId) {
    hasHandledScheduledBooking = false;
    calendlyOpenTimestamp = Date.now();

    var finalName = name;
    var finalPhone = phone;
    var finalCountryCode = countryCode || '+91';

    if (!finalName) {
      var nameEl = document.getElementById('fullName');
      finalName = nameEl ? nameEl.value.trim() : 'Student';
    }
    if (!finalPhone) {
      var phoneEl = document.getElementById('phone');
      var ph = phoneEl ? phoneEl.value.trim() : '';
      finalPhone = ph ? (finalCountryCode + ' ' + ph) : '';
    }

    currentBookingState = {
      name: finalName,
      phone: finalPhone,
      countryCode: finalCountryCode,
      date: date,
      slot: slot,
      selectedCounsellor: counsellorId || 'counsellor1',
      selectedCounsellorUrl: targetUrl || ''
    };

    document.body.style.overflow = 'hidden';
    lastActiveElement = document.activeElement;

    // Remove any leftover success banners from previous opens
    var modalHeader = document.querySelector('.calendly-modal-header');
    if (modalHeader) {
      var oldBanner = modalHeader.querySelector('.calendly-success-banner');
      if (oldBanner) oldBanner.remove();
    }

    if (calendlyModal) {
      calendlyModal.setAttribute('aria-hidden', 'false');
      calendlyModal.style.display = 'flex';
      calendlyModal.style.filter = 'none';
      calendlyModal.style.pointerEvents = 'auto';
    }

    if (calendlyShimmer) calendlyShimmer.style.display = 'flex';
    if (calendlyFallback) calendlyFallback.style.display = 'none';
    if (calendlyWidgetContainer) {
      calendlyWidgetContainer.style.display = 'block';
      calendlyWidgetContainer.style.minHeight = '660px';
      calendlyWidgetContainer.style.width = '100%';
      calendlyWidgetContainer.innerHTML = '';
    }

    var rawUrl = targetUrl || selectedCounsellorUrl || counsellorUrls['counsellor1'] || 'https://calendly.com/starsamir9955/new-meeting';
    var finalBookingUrl = rawUrl;
    try {
      var savedLeadObj = {};
      try {
        savedLeadObj = JSON.parse(sessionStorage.getItem('amc_lead_user') || localStorage.getItem('amc_lead_user') || '{}');
      } catch (e) {}

      var urlObj = new URL(rawUrl);
      if (finalName) urlObj.searchParams.set('name', finalName);
      if (savedLeadObj.email) urlObj.searchParams.set('email', savedLeadObj.email);
      if (finalPhone) urlObj.searchParams.set('a1', finalPhone);
      if (slot) urlObj.searchParams.set('a2', slot);
      if (date) urlObj.searchParams.set('a3', date);
      urlObj.searchParams.set('embed_domain', window.location.host || window.location.hostname || 'localhost');
      urlObj.searchParams.set('embed_type', 'Inline');
      finalBookingUrl = urlObj.toString();
    } catch (e) {
      finalBookingUrl = rawUrl;
    }

    var directLink = document.getElementById('calendlyDirectLink');
    if (directLink) {
      directLink.href = finalBookingUrl;
    }

    // Direct Full-Size Iframe Render
    var iframe = document.createElement('iframe');
    iframe.src = finalBookingUrl;
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.frameBorder = '0';
    iframe.title = 'Schedule Consultation';
    iframe.style.border = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.minHeight = '660px';
    iframe.style.borderRadius = '16px';

    iframe.onload = function () {
      if (calendlyShimmer) calendlyShimmer.style.display = 'none';
      if (calendlyWidgetContainer) calendlyWidgetContainer.style.display = 'block';
    };

    calendlyWidgetContainer.appendChild(iframe);

    // Fallback timer to hide shimmer quickly
    setTimeout(function () {
      if (calendlyShimmer) calendlyShimmer.style.display = 'none';
      if (calendlyWidgetContainer) calendlyWidgetContainer.style.display = 'block';
    }, 600);

    // Gentle fallback check (does not spam Calendly while student is filling the form)
    if (calendlyPollInterval) {
      clearInterval(calendlyPollInterval);
      calendlyPollInterval = null;
    }
    // Only check periodically after 10 seconds of modal being open
    setTimeout(function () {
      if (hasHandledScheduledBooking || !calendlyModal || calendlyModal.getAttribute('aria-hidden') === 'true') return;
      calendlyPollInterval = setInterval(function () {
        if (hasHandledScheduledBooking) {
          clearInterval(calendlyPollInterval);
          calendlyPollInterval = null;
          return;
        }
        var checkUrl = '/api/calendly/check-scheduled?since=' + calendlyOpenTimestamp + '&phone=' + encodeURIComponent(finalPhone);
        fetch(checkUrl)
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && data.scheduled && data.event && !hasHandledScheduledBooking) {
              handleBookingCompleted(data.event.calendlyEventUri, data.event);
            }
          })
          .catch(function () {});
      }, 5000);
    }, 10000);
  }

  function closeCalendlyModalFlow() {
    if (calendlyPollInterval) {
      clearInterval(calendlyPollInterval);
      calendlyPollInterval = null;
    }
    document.body.style.overflow = '';
    if (calendlyModal) {
      calendlyModal.setAttribute('aria-hidden', 'true');
      calendlyModal.style.display = 'none';
    }
    if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
      lastActiveElement.focus();
    }
  }

    // Reset confirmation overlay state on modal open
    var confirmOverlay = document.getElementById('calendlyConfirmOverlay');
    if (confirmOverlay) {
      confirmOverlay.style.display = 'none';
      var spinner = document.getElementById('confirmSpinnerIcon');
      if (spinner) spinner.classList.remove('is-success');
      var progress = document.getElementById('confirmProgressFill');
      if (progress) progress.classList.remove('is-done');
      var title = document.getElementById('confirmTitle');
      if (title) title.textContent = 'Confirming Your Session...';
      var subtitle = document.getElementById('confirmSubtitle');
      if (subtitle) subtitle.textContent = 'Connecting with Calendly & syncing your appointment details';
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

    // Manual Fast-Confirm Button
    var btnConfirmNow = document.getElementById('btnConfirmNow');
    if (btnConfirmNow) {
      btnConfirmNow.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var overlay = document.getElementById('calendlyConfirmOverlay');
        if (overlay) overlay.style.display = 'flex';
        handleBookingCompleted(null, currentBookingState);
      });
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

  // ---------- TERMS & CONDITIONS MODAL CONTROLLER ----------
  var termsLink = document.getElementById('termsLink');
  var termsModal = document.getElementById('termsModal');
  var closeTermsModal = document.getElementById('closeTermsModal');
  var btnTermsAccept = document.getElementById('btnTermsAccept');

  function openTermsModalFlow() {
    if (!termsModal) return;
    termsModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeTermsModalFlow() {
    if (!termsModal) return;
    termsModal.setAttribute('aria-hidden', 'true');
    var entryModalOpen = document.getElementById('entryModal') && document.getElementById('entryModal').getAttribute('aria-hidden') === 'false';
    var calModalOpen = document.getElementById('calendlyModal') && document.getElementById('calendlyModal').getAttribute('aria-hidden') === 'false';
    if (!entryModalOpen && !calModalOpen) {
      document.body.style.overflow = '';
    }
  }

  if (termsLink) {
    termsLink.addEventListener('click', function (e) {
      e.preventDefault();
      openTermsModalFlow();
    });
  }

  if (closeTermsModal) {
    closeTermsModal.addEventListener('click', function (e) {
      e.preventDefault();
      closeTermsModalFlow();
    });
  }

  if (btnTermsAccept) {
    btnTermsAccept.addEventListener('click', function (e) {
      e.preventDefault();
      closeTermsModalFlow();
    });
  }

  if (termsModal) {
    termsModal.addEventListener('click', function (e) {
      if (e.target === termsModal) {
        closeTermsModalFlow();
      }
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && termsModal && termsModal.getAttribute('aria-hidden') === 'false') {
      closeTermsModalFlow();
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

    var date = document.getElementById('prefDate') ? document.getElementById('prefDate').value : '';
    var slotInput = counsellingForm ? counsellingForm.querySelector('input[name="slot"]:checked') : null;
    var slot = slotInput ? slotInput.value : 'Any Available Time';

    var prettyDate = 'Selected Date';
    if (date) {
      try {
        prettyDate = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      } catch (e) {
        prettyDate = date;
      }
    }

    var targetUrl = selectedCounsellorUrl || counsellorUrls['counsellor1'] || 'https://calendly.com/starsamir9955/new-meeting';

    var savedLead = {};
    try {
      savedLead = JSON.parse(sessionStorage.getItem('amc_lead_user') || localStorage.getItem('amc_lead_user') || '{}');
    } catch (e) {}

    var counsellorName = (selectedCounsellorId === 'counsellor2' || selectedCounsellorId === 'aryan') ? 'Counsellor 2 (Aryan Raj)' : 'Counsellor 1 (starsamir9955)';

    postJson('/api/admin/bookings/intent', {
      name: validation.name,
      email: savedLead.email || null,
      phone: validation.phone,
      countryCode: validation.countryCode,
      preferredDate: prettyDate,
      selectedSlot: slot,
      selectedCounsellor: counsellorName,
      selectedCounsellorUrl: targetUrl,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
      source: savedLead.source || 'Website Lead Modal',
      sourceOther: savedLead.sourceOther || null,
      notes: 'Opened Calendly booking slot picker modal'
    }).then(function (intentRes) {
      if (intentRes && intentRes.bookingId) {
        currentBookingState.bookingId = intentRes.bookingId;
      }
    }).catch(function (err) {
      console.warn('[Booking Intent Save Warning]', err);
    });

    openCalendlyModalFlow(validation.name, validation.phone, validation.countryCode, prettyDate, slot, targetUrl, selectedCounsellorId);
  }

  if (counsellingForm) {
    var dateInput = document.getElementById('prefDate');
    if (dateInput) {
      dateInput.addEventListener('change', function () {
        if (!dateInput.value) return;
        handleDateOrTimeSelection();
      });
    }

    var slotInputs = counsellingForm.querySelectorAll('input[name="slot"]');
    slotInputs.forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        var dateField = document.getElementById('prefDate');
        if (!dateField || !dateField.value) {
          var today = new Date();
          var yyyy = today.getFullYear();
          var mm = String(today.getMonth() + 1).padStart(2, '0');
          var dd = String(today.getDate()).padStart(2, '0');
          if (dateField) dateField.value = yyyy + '-' + mm + '-' + dd;
        }
        handleDateOrTimeSelection();
      });
    });

    counsellingForm.addEventListener('submit', function (e) {
      e.preventDefault();
      handleDateOrTimeSelection();
    });

    var submitBtn = counsellingForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var dateField = document.getElementById('prefDate');
        if (!dateField || !dateField.value) {
          var today = new Date();
          var yyyy = today.getFullYear();
          var mm = String(today.getMonth() + 1).padStart(2, '0');
          var dd = String(today.getDate()).padStart(2, '0');
          if (dateField) dateField.value = yyyy + '-' + mm + '-' + dd;
        }
        handleDateOrTimeSelection();
      });
    }

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



  }

  // Calendly Schedule Listener (PostMessage + View Confirmation + Guaranteed 2s Auto-Close)
  window.addEventListener('message', function (e) {
    if (!e.data) return;

    var isScheduled = false;
    var eventUri = null;

    try {
      if (typeof e.data === 'object' && e.data !== null) {
        var evName = e.data.event || e.data.action || e.data.type || '';
        if (typeof evName === 'string' && (evName === 'calendly.event_scheduled' || evName.indexOf('event_scheduled') !== -1)) {
          isScheduled = true;
          eventUri = e.data.payload && e.data.payload.event && e.data.payload.event.uri;
        }
      } else if (typeof e.data === 'string') {
        if (e.data.indexOf('event_scheduled') !== -1) {
          isScheduled = true;
          try {
            var parsed = JSON.parse(e.data);
            eventUri = parsed.payload && parsed.payload.event && parsed.payload.event.uri;
          } catch (err) {}
        }
      }
    } catch (err) {
      console.warn('[Calendly postMessage Parse Warning]', err);
    }

    if (isScheduled) {
      handleBookingCompleted(eventUri);
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
  /* ---- Auto-fill enrollment/counselling form helper ---- */
  function autofillEnrollmentForm(leadData) {
    if (!leadData) return;
    var name = leadData.name || '';
    var phone = leadData.phoneOnly || (leadData.phone ? String(leadData.phone).replace(/^\+\d+\s*/, '').trim() : '');
    var countryCode = leadData.countryCode || '+91';

    var fullNameInput = document.getElementById('fullName');
    if (fullNameInput && name) {
      fullNameInput.value = name;
      fullNameInput.setAttribute('value', name);
    }

    var phoneInput = document.getElementById('phone');
    if (phoneInput && phone) {
      phoneInput.value = phone;
      phoneInput.setAttribute('value', phone);
    }

    var countryHidden = document.getElementById('countryCode');
    if (countryHidden) countryHidden.value = countryCode;

    var countryCodeEl = document.getElementById('selectedCountryCode');
    if (countryCodeEl) countryCodeEl.textContent = countryCode;

    var flagEl = document.getElementById('selectedCountryFlag');
    if (flagEl) {
      var isoMap = {
        '+61': 'au', '+91': 'in', '+44': 'gb', '+1': 'us',
        '+64': 'nz', '+353': 'ie', '+27': 'za', '+65': 'sg',
        '+60': 'my', '+971': 'ae', '+966': 'sa', '+92': 'pk',
        '+977': 'np', '+880': 'bd', '+94': 'lk'
      };
      var iso = isoMap[countryCode] || 'in';
      flagEl.innerHTML = '<img src="https://flagcdn.com/w20/' + iso + '.png" width="18" style="border-radius:2px; box-shadow: 0 1px 2px rgba(0,0,0,0.15); display:inline-block; vertical-align:middle; margin-right:4px;" alt="Flag">';
    }
  }

  // Pre-fill on initial page load if lead exists in session
  try {
    var storedLead = JSON.parse(sessionStorage.getItem('amc_lead_user') || 'null');
    if (storedLead) {
      autofillEnrollmentForm(storedLead);
    }
  } catch (e) {}

  /* ---- Entry modal: opens cleanly on visit, auto-fills form on submit, and stays closed for the rest of that visit ---- */
  var entryModal = document.getElementById('entryModal');
  var entryForm = document.getElementById('entryForm');
  var entryError = document.getElementById('entryError');
  var pageContent = document.getElementById('pageContent');

  if (entryModal && entryForm && pageContent) {
    var hasSubmittedOnVisit = false;
    var modalTimer = null;

    var openModal = function () {
      if (hasSubmittedOnVisit) return;
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
      if (modalTimer) {
        clearTimeout(modalTimer);
        modalTimer = null;
      }
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

    // Open popup after 1.5 seconds on reload
    modalTimer = setTimeout(openModal, 1500);

    var entryNameInput = document.getElementById('entryName');
    var entryPhoneInput = document.getElementById('entryPhone');
    var entryCountryCodeInput = document.getElementById('entryCountryCode');

    // Real-time input synchronization as user types
    if (entryNameInput) {
      entryNameInput.addEventListener('input', function () {
        var fn = document.getElementById('fullName');
        if (fn) {
          fn.value = entryNameInput.value;
          fn.setAttribute('value', entryNameInput.value);
        }
      });
    }
    if (entryPhoneInput) {
      entryPhoneInput.addEventListener('input', function () {
        var ph = document.getElementById('phone');
        if (ph) {
          ph.value = entryPhoneInput.value;
          ph.setAttribute('value', entryPhoneInput.value);
        }
      });
    }

    var otherGroup = document.getElementById('entrySourceOtherGroup');
    var otherInput = document.getElementById('entrySourceOther');

    var validateEntryForm = function () {
      var name = entryNameInput ? entryNameInput.value.trim() : '';
      var email = document.getElementById('entryEmail') ? document.getElementById('entryEmail').value.trim() : '';
      var rawPhone = entryPhoneInput ? entryPhoneInput.value.trim() : '';
      var source = document.getElementById('entrySource') ? document.getElementById('entrySource').value : '';
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

    entryForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var error = validateEntryForm();
      if (error) {
        if (entryError) entryError.textContent = error; else alert(error);
        return;
      }
      if (entryError) entryError.textContent = '';

      var nameVal = entryNameInput ? entryNameInput.value.trim() : '';
      var phoneVal = entryPhoneInput ? entryPhoneInput.value.trim() : '';
      var countryCodeVal = entryCountryCodeInput ? entryCountryCodeInput.value.trim() : '+91';
      var emailVal = document.getElementById('entryEmail') ? document.getElementById('entryEmail').value.trim() : '';
      var sourceVal = document.getElementById('entrySource') ? document.getElementById('entrySource').value : '';
      var otherVal = otherInput ? otherInput.value.trim() : '';

      var leadPayload = {
        name: nameVal,
        email: emailVal,
        countryCode: countryCodeVal,
        phoneOnly: phoneVal,
        phone: countryCodeVal + ' ' + phoneVal,
        source: sourceVal,
        sourceOther: otherVal
      };

      // Save lead payload to browser storage for subsequent booking intents
      try {
        sessionStorage.setItem('amc_lead_user', JSON.stringify(leadPayload));
        localStorage.setItem('amc_lead_user', JSON.stringify(leadPayload));
      } catch (e) {}

      // 1. Direct Synchronous Population into the Enrollment Form
      var fnField = document.getElementById('fullName');
      if (fnField && nameVal) {
        fnField.value = nameVal;
        fnField.setAttribute('value', nameVal);
      }
      var phField = document.getElementById('phone');
      if (phField && phoneVal) {
        phField.value = phoneVal;
        phField.setAttribute('value', phoneVal);
      }
      var ccField = document.getElementById('countryCode');
      if (ccField && countryCodeVal) {
        ccField.value = countryCodeVal;
      }
      var sccSpan = document.getElementById('selectedCountryCode');
      if (sccSpan) {
        sccSpan.textContent = countryCodeVal;
      }
      var scfSpan = document.getElementById('selectedCountryFlag');
      if (scfSpan) {
        var isoMap = {
          '+61': 'au', '+91': 'in', '+44': 'gb', '+1': 'us',
          '+64': 'nz', '+353': 'ie', '+27': 'za', '+65': 'sg',
          '+60': 'my', '+971': 'ae', '+966': 'sa', '+92': 'pk',
          '+977': 'np', '+880': 'bd', '+94': 'lk'
        };
        var iso = isoMap[countryCodeVal] || 'in';
        scfSpan.innerHTML = '<img src="https://flagcdn.com/w20/' + iso + '.png" width="18" style="border-radius:2px; box-shadow: 0 1px 2px rgba(0,0,0,0.15); display:inline-block; vertical-align:middle; margin-right:4px;" alt="Flag">';
      }

      // Also invoke helper
      autofillEnrollmentForm(leadPayload);

      // 2. Mark submitted on this visit so it does not pop up again while browsing
      hasSubmittedOnVisit = true;
      if (modalTimer) {
        clearTimeout(modalTimer);
        modalTimer = null;
      }

      // 3. Close modal smoothly (preserve current page scroll position)
      closeModal();

      // 4. Post lead to backend API
      postJson('/api/admin/leads', leadPayload).catch(function (err) {
        console.warn('[Lead Save Warning]', err);
      });
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
