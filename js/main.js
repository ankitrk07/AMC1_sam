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

  /* ---- VSL video: fallback panel + tap-for-sound ---- */
  var video = document.getElementById('vslVideo');
  var fallback = document.getElementById('vslFallback');
  var soundBtn = document.getElementById('vslSoundBtn');
  var soundLabel = document.getElementById('vslSoundLabel');

  if (video) {
    var showFallback = function () { if (fallback) fallback.style.display = 'flex'; };
    var hideFallback = function () { if (fallback) fallback.style.display = 'none'; };
    video.addEventListener('error', showFallback);
    video.addEventListener('loadeddata', hideFallback);
    if (!video.currentSrc) showFallback();
  }

  if (soundBtn && video) {
    soundBtn.addEventListener('click', function () {
      video.muted = !video.muted;
      var isMuted = video.muted;
      soundBtn.setAttribute('aria-pressed', String(!isMuted));
      soundLabel.textContent = isMuted ? 'Tap for sound' : 'Mute';
      if (!isMuted) { video.play().catch(function () {}); }
    });
  }

  /* ---- 4-number accordion ---- */
  var stages = document.querySelectorAll('.stage');
  stages.forEach(function (stage) {
    var head = stage.querySelector('.stage__head');
    if (!head) return;
    head.addEventListener('click', function () {
      var isOpen = stage.getAttribute('data-open') === 'true';
      stages.forEach(function (s) {
        s.setAttribute('data-open', 'false');
        var h = s.querySelector('.stage__head');
        if (h) h.setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        stage.setAttribute('data-open', 'true');
        head.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ---- Counselling booking form ----
     No payment happens anywhere on this page. Collects name, phone,
     preferred date and time slot, then hands the request to a
     counsellor via WhatsApp. Replace WHATSAPP_NUMBER with the real
     counselling number (country code, digits only). ---- */
  var WHATSAPP_NUMBER = '918092309210';

  var counsellingForm = document.getElementById('counsellingForm');
  var prefDateInput = document.getElementById('prefDate');
  var counsellingFine = document.getElementById('counsellingFine');

  if (prefDateInput) {
    var today = new Date();
    prefDateInput.setAttribute('min', today.toISOString().split('T')[0]);
  }

  if (counsellingForm) {
    counsellingForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('fullName').value.trim();
      var phone = document.getElementById('phone').value.trim();
      var date = document.getElementById('prefDate').value;
      var slotInput = counsellingForm.querySelector('input[name="slot"]:checked');

      if (!name || !phone || !date || !slotInput) {
        counsellingFine.textContent = 'Please fill your name, phone, date and pick a time slot.';
        counsellingFine.classList.add('is-error');
        counsellingFine.classList.remove('is-success');
        return;
      }

      var slot = slotInput.value;
      var prettyDate = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      var message =
        'Hi, I would like to book a free counselling session for the AMC 1 Preparation Program.%0A%0A' +
        'Name: ' + encodeURIComponent(name) + '%0A' +
        'Phone: ' + encodeURIComponent(phone) + '%0A' +
        'Preferred Date: ' + encodeURIComponent(prettyDate) + '%0A' +
        'Preferred Time Slot: ' + encodeURIComponent(slot);

      counsellingFine.textContent = 'Thanks! Opening WhatsApp to confirm your slot…';
      counsellingFine.classList.add('is-success');
      counsellingFine.classList.remove('is-error');

      window.open('https://wa.me/' + WHATSAPP_NUMBER + '?text=' + message, '_blank');
      counsellingForm.reset();
    });
  }

  /* ---- Smooth-scroll offset for sticky header on in-page links ---- */
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var id = link.getAttribute('href').slice(1);
      var target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        var headerOffset = 76;
        var top = target.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: top, behavior: 'smooth' });
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
    };

    var closeModal = function () {
      entryModal.setAttribute('aria-hidden', 'true');
      pageContent.style.filter = '';
      pageContent.style.pointerEvents = '';
      pageContent.style.userSelect = '';
      document.body.style.overflow = '';
    };

    var validateEntryForm = function () {
      var name = document.getElementById('entryName').value.trim();
      var email = document.getElementById('entryEmail').value.trim();
      var phone = document.getElementById('entryPhone').value.trim();
      var source = document.getElementById('entrySource').value;
      var digits = phone.replace(/\D/g, '');

      if (!name || !/^[A-Za-z\s]{3,}$/.test(name) || name.split(/\s+/).filter(Boolean).length < 2) {
        return 'Please enter your full name (first and last name).';
      }
      if (!email || !/^[^\s@]+@gmail\.com$/i.test(email)) {
        return 'Please enter a valid @gmail.com email address.';
      }
      if (digits.length !== 10) {
        return 'Please enter a valid 10-digit phone number.';
      }
      if (!source) {
        return 'Please tell us where you heard about us.';
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
        var label = option.textContent.trim();
        sourceInput.value = value;
        sourceValue.textContent = label;
        sourceList.querySelectorAll('.select-option').forEach(function (item) {
          item.setAttribute('aria-selected', item === option ? 'true' : 'false');
        });
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