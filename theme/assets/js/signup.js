/* ============================================================================
   POTHOLE NEWS - signal-theme - signup.js  (FREE static path)
   Progressive enhancement for the standing-request / newsletter card
   ([data-signup]). The $0 static build has no Ghost Members, so this posts the
   email to the same free relay the tip line uses (Web3Forms-class), then shows
   the FILED stamp. With no key set it falls back to a prefilled mailto to the
   desk - so the card works today with zero setup and no account.

   The newsletter *sender* (a free-tier list) is chosen at first-subscriber time
   (WEBSITE-MASTER-BUILD-PLAN §9 / W5-FREE). Until then this routes interest to
   the assignment desk. No account, no CAPTCHA.
   ----------------------------------------------------------------------------
   OPERATOR SETUP (a TJ step - the SAME Web3Forms key as the tip line):
     set ENDPOINT + ACCESS_KEY below (or leave blank to keep the mailto fallback).
   ============================================================================ */
(function () {
  'use strict';

  var ENDPOINT = 'https://api.web3forms.com/submit';                                 // e.g. 'https://api.web3forms.com/submit'
  var ACCESS_KEY = 'c64c1b56-33e7-43c2-9194-92a14edfccc7';                               // Web3Forms access key (same as tips.js)
  var DESK_EMAIL = 'assignmentdesk26@gmail.com';     // mailto fallback destination

  var forms = document.querySelectorAll('[data-signup]');
  if (!forms.length) return;

  Array.prototype.forEach.call(forms, function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('.req__email') || form.querySelector('input[type="email"]');
      var email = input ? String(input.value || '').trim() : '';
      if (!email || email.indexOf('@') === -1) {
        if (input) input.focus();
        return;
      }
      var subject = 'Newsletter signup - Pothole News';
      var fromPage = location.pathname || '/';

      if (ENDPOINT && ACCESS_KEY) {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            access_key: ACCESS_KEY,
            subject: subject,
            email: email,
            from_page: fromPage,
            message: 'New standing-request / newsletter signup from ' + fromPage,
          }),
        }).then(function () { succeed(form); })
          .catch(function () { mailto(email, subject); succeed(form); });
      } else {
        mailto(email, subject);
        succeed(form);
      }
    });
  });

  function mailto(email, subject) {
    var body = 'Please add me to the free weekly roundup: ' + email +
      '\n\nSent from the Pothole News standing-request card.';
    var href = 'mailto:' + DESK_EMAIL + '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
    var a = document.createElement('a');
    a.href = href; a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function succeed(form) {
    form.classList.add('success');   // CSS :has()/.success reveals the FILED stamp
    var ok = form.parentNode && form.parentNode.querySelector('.req__success');
    if (ok) ok.setAttribute('role', 'status');
  }
})();
