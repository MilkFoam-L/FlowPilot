// content/paypal-realtime-register.js — Runtime PayPal/OpenAI checkout registration helper.

(function attachPayPalRealtimeRegister(root) {
  const CONFIG = {
    phone: '9432832479',
    cardNumber: '4859540133342906',
    cardExpiry: '01 / 30',
    cardCvv: '161',
  };

  function log(message) {
    console.log(`[PP] ${message}`);
  }

  function installVisualOverrides() {
    if (document.getElementById('pp-auto-style')) return;
    const style = document.createElement('style');
    style.id = 'pp-auto-style';
    style.textContent = '#captcha-standalone,.captcha-overlay,.captcha-container,.AddressAutocomplete-results{display:none!important;height:0!important;overflow:hidden!important}';
    document.head.appendChild(style);
  }

  function ensureNoticeBox() {
    let noticeBox = document.getElementById('pp-auto-notice');
    if (noticeBox) return noticeBox;
    noticeBox = document.createElement('div');
    noticeBox.id = 'pp-auto-notice';
    noticeBox.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'max-width:320px',
      'padding:12px 14px',
      'border-radius:10px',
      'background:rgba(20,20,20,0.95)',
      'color:#fff',
      'font:13px/1.5 Arial,sans-serif',
      'box-shadow:0 8px 24px rgba(0,0,0,0.25)',
      'white-space:pre-wrap',
    ].join(';');
    noticeBox.textContent = 'PayPal helper ready';
    document.body.appendChild(noticeBox);
    return noticeBox;
  }

  function showNotice(message) {
    ensureNoticeBox().textContent = message;
  }

  function isSmsOrVerificationPrompt(text) {
    const value = String(text || '').toLowerCase();
    return value.includes('sms')
      || value.includes('verification code')
      || value.includes('security code')
      || value.includes('one-time code')
      || value.includes('otp')
      || value.includes('text message')
      || value.includes('enter code');
  }

  function scanForVerificationPrompt() {
    const candidates = Array.from(document.querySelectorAll('body *'));
    for (const el of candidates) {
      if (!el || el.children.length > 0) continue;
      const text = String(el.textContent || '').trim();
      if (text && isSmsOrVerificationPrompt(text)) {
        showNotice('Detected SMS / verification prompt.\nPlease enter the code manually.');
        return true;
      }
    }
    return false;
  }

  function watchForVerificationPrompt() {
    if (root.__PAYPAL_REALTIME_REGISTER_WATCHING__) return;
    root.__PAYPAL_REALTIME_REGISTER_WATCHING__ = true;
    scanForVerificationPrompt();
    root.setInterval(scanForVerificationPrompt, 1500);
    const observer = new MutationObserver(scanForVerificationPrompt);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  function randomEmail() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let index = 0; index < 16; index += 1) {
      value += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${value}@gmail.com`;
  }

  function randomPassword() {
    const lowerUpper = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const symbols = '!@#$%^';
    const all = lowerUpper + digits + symbols;
    let password = lowerUpper[Math.floor(Math.random() * 26)]
      + lowerUpper[26 + Math.floor(Math.random() * 26)]
      + digits[Math.floor(Math.random() * digits.length)]
      + symbols[Math.floor(Math.random() * symbols.length)];
    for (let index = 4; index < 14; index += 1) {
      password += all[Math.floor(Math.random() * all.length)];
    }
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  function setInputValue(el, value) {
    if (!el) return false;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function fillById(id, value) {
    const el = document.getElementById(id);
    if (!setInputValue(el, value)) {
      log(`NOT FOUND: ${id}`);
      return false;
    }
    log(`${id} = ${el.value}`);
    return true;
  }

  function fillBySelector(selector, value) {
    const el = document.querySelector(selector);
    if (!setInputValue(el, value)) {
      log(`NOT FOUND: ${selector}`);
      return false;
    }
    log(`${selector} = ${el.value}`);
    return true;
  }

  function fillSelect(id, text) {
    const el = document.getElementById(id);
    if (!el) {
      log(`NOT FOUND: ${id}`);
      return false;
    }
    const query = String(text || '').toLowerCase();
    for (const option of Array.from(el.options || [])) {
      if (String(option.text || '').toLowerCase().includes(query) || String(option.value || '').toLowerCase().includes(query)) {
        el.value = option.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        log(`${id} = ${option.text}`);
        return true;
      }
    }
    return false;
  }

  async function getAddress() {
    log('Fetching address from meiguodizhi.com API...');
    try {
      const response = await fetch('https://www.meiguodizhi.com/api/v1/dz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/', method: 'address' }),
      });
      const data = await response.json();
      const address = data.address || data;
      return {
        street: address.Address || address.street || '123 Main St',
        city: address.City || address.city || 'New York',
        state: address.State_Full || address.State || address.state || 'New York',
        zip: String(address.Zip_Code || address.zip || '10001').slice(0, 5),
      };
    } catch (err) {
      log(`Address request failed: ${err?.message || err}`);
      return { street: '123 Main St', city: 'New York', state: 'New York', zip: '10001' };
    }
  }

  function findSubmitButton() {
    return document.querySelector('button[data-testid="submit-button"]')
      || document.querySelector('button[data-testid="hosted-payment-submit-button"]')
      || document.querySelector('button[data-atomic-wait-intent="Submit_Email"]')
      || document.querySelector('button.SubmitButton--complete')
      || Array.from(document.querySelectorAll('button')).find((button) => {
        const text = String(button.textContent || '').trim();
        return ['下一页', 'Next', 'Subscribe', 'Pay', 'Continue', 'Agree'].includes(text);
      })
      || null;
  }

  async function clickButton(retries = 0) {
    const button = findSubmitButton();
    if (!button) {
      if (retries < 10) {
        await sleep(1000);
        return clickButton(retries + 1);
      }
      return false;
    }
    if (button.disabled) {
      if (retries < 10) {
        await sleep(1000);
        return clickButton(retries + 1);
      }
      return false;
    }
    const rect = button.getBoundingClientRect();
    if (rect.height === 0) {
      if (retries < 10) {
        await sleep(1000);
        return clickButton(retries + 1);
      }
      return false;
    }
    log(`Clicking: ${String(button.textContent || '').trim()}`);
    button.click();
    return true;
  }

  async function runOpenAiStripeCheckout() {
    log('=== OpenAI/Stripe Page ===');
    await sleep(2000);
    const paypalButton = document.querySelector('[data-testid="paypal-accordion-item-button"]')
      || document.querySelector('.paypal-accordion-item button');
    if (paypalButton) {
      paypalButton.click();
      await sleep(500);
      paypalButton.click();
    }
    await sleep(3000);
    const address = await getAddress();
    fillBySelector('#billingAddressLine1', address.street);
    fillBySelector('#billingLocality', address.city);
    fillBySelector('#billingPostalCode', address.zip);
    fillSelect('billingAdministrativeArea', address.state);
    const checkbox = document.getElementById('termsOfServiceConsentCheckbox');
    if (checkbox && !checkbox.checked) checkbox.click();
    await sleep(1000);
    await clickButton();
    return { ran: true, phase: 'checkout_payment_selected' };
  }

  async function runPayPalPay() {
    log('=== PayPal Login Page ===');
    await sleep(2000);
    const email = randomEmail();
    fillById('email', email);
    await sleep(1000);
    await clickButton();
    return { ran: true, phase: 'email_submitted', awaiting: 'paypal_checkoutweb' };
  }

  async function runPayPalCheckoutWeb() {
    log('=== PayPal Checkout Page ===');
    await sleep(2000);
    const country = document.getElementById('country');
    if (country && country.value !== 'US') {
      country.value = 'US';
      country.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(3000);
    }
    const address = await getAddress();
    const email = randomEmail();
    const password = randomPassword();
    fillById('email', email);
    fillById('phone', CONFIG.phone);
    fillById('cardNumber', CONFIG.cardNumber);
    fillById('cardExpiry', CONFIG.cardExpiry);
    fillById('cardCvv', CONFIG.cardCvv);
    fillById('password', password);
    fillById('firstName', 'James');
    fillById('lastName', 'Smith');
    fillById('billingLine1', address.street);
    fillById('billingCity', address.city);
    fillById('billingPostalCode', address.zip);
    fillSelect('billingState', address.state);
    await sleep(500);
    await clickButton();
    return { ran: true, phase: 'registration_submitted', awaiting: 'redirect_or_approval' };
  }

  async function runPayPalRealtimeRegister() {
    installVisualOverrides();
    watchForVerificationPrompt();
    const host = window.location.host;
    const path = window.location.pathname;
    if (host.includes('pay.openai.com') || host.includes('checkout.stripe.com')) {
      return runOpenAiStripeCheckout();
    }
    if (host.includes('paypal.com') && path === '/pay') {
      return runPayPalPay();
    }
    if (host.includes('paypal.com') && path.includes('/checkoutweb/')) {
      return runPayPalCheckoutWeb();
    }
    log('Page not matched');
    return { ran: false, phase: 'not_matched', url: window.location.href };
  }

  root.PayPalRealtimeRegister = {
    run: runPayPalRealtimeRegister,
    _private: { randomEmail, randomPassword, isSmsOrVerificationPrompt },
  };
})(typeof window !== 'undefined' ? window : globalThis);
