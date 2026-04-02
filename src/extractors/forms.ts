import type { CheerioAPI } from 'cheerio';
import type { FormInfo, FormField } from '../core/snapshot';

/**
 * Extract all forms and their fields from the page.
 * Classifies each form by purpose (contact, login, search, subscribe, etc.)
 */
export function extractForms($: CheerioAPI, baseUrl: string): FormInfo[] {
  const forms: FormInfo[] = [];
  let counter = 0;

  $('form').each((_, el) => {
    const $form = $(el);
    counter++;

    const action = $form.attr('action') || '';
    const method = ($form.attr('method') || 'GET').toUpperCase();
    const formId = $form.attr('id') || `form${counter}`;

    const fields: FormField[] = [];
    let fieldCounter = 0;

    // Inputs
    $form.find('input, textarea, select').each((_, fieldEl) => {
      const $field = $(fieldEl);
      const type = ($field.attr('type') || (fieldEl.tagName === 'textarea' ? 'textarea' : fieldEl.tagName === 'select' ? 'select' : 'text')).toLowerCase();
      
      // Skip submit/button/hidden from field list (submit handled separately)
      if (type === 'submit' || type === 'button' || type === 'image') return;

      fieldCounter++;
      const name = $field.attr('name') || '';
      const id = $field.attr('id') || '';
      const placeholder = $field.attr('placeholder') || '';
      const required = $field.attr('required') !== undefined || $field.attr('aria-required') === 'true';
      const value = $field.attr('value') || '';

      // Try to find label
      let label = '';
      if (id) {
        const $label = $(`label[for="${id}"]`);
        if ($label.length) label = $label.text().replace(/\s+/g, ' ').trim();
      }
      if (!label) {
        const $parent = $field.closest('label');
        if ($parent.length) label = $parent.text().replace(/\s+/g, ' ').trim();
      }
      if (!label) label = placeholder || name;

      // Extract select options
      let options: string[] | undefined;
      if (type === 'select' || fieldEl.tagName === 'select') {
        options = [];
        $field.find('option').each((_, opt) => {
          const optText = $(opt).text().trim();
          if (optText && optText !== '---') options!.push(optText);
        });
      }

      fields.push({
        id: id || `${formId}_field${fieldCounter}`,
        type: fieldEl.tagName === 'textarea' ? 'textarea' : fieldEl.tagName === 'select' ? 'select' : type,
        label: label.substring(0, 80),
        name,
        required,
        placeholder: placeholder || undefined,
        options: options?.length ? options : undefined,
        value: type !== 'password' ? value || undefined : undefined,
      });
    });

    // Skip empty forms or forms with only hidden fields
    const visibleFields = fields.filter(f => f.type !== 'hidden');
    if (visibleFields.length === 0) return;

    const purpose = classifyForm($form, action, fields);

    forms.push({
      id: formId,
      action: resolveAction(action, baseUrl),
      method,
      purpose,
      fields,
    });
  });

  return forms;
}

function classifyForm($form: ReturnType<CheerioAPI>, action: string, fields: FormField[]): string {
  const html = $form.html()?.toLowerCase() || '';
  const fieldNames = fields.map(f => (f.name + ' ' + f.label).toLowerCase()).join(' ');
  const actionLower = action.toLowerCase();

  // Search
  if (fields.length <= 2 && (
    fields.some(f => f.type === 'search') ||
    /search/i.test(fieldNames) ||
    /search/i.test(actionLower)
  )) return 'search';

  // Login
  if (fields.some(f => f.type === 'password') && fields.length <= 4 && (
    /login|signin|sign.in/i.test(actionLower) ||
    /login|sign.in/i.test(html)
  )) return 'login';

  // Signup
  if (fields.some(f => f.type === 'password') && (
    /signup|register|sign.up|create.account/i.test(actionLower) ||
    /signup|register|sign.up|create.account/i.test(html) ||
    fields.length > 4
  )) return 'signup';

  // Subscribe / Newsletter
  if (fields.length <= 2 && fields.some(f => f.type === 'email') && (
    /subscribe|newsletter|mailing/i.test(html) ||
    /subscribe|newsletter/i.test(actionLower)
  )) return 'subscribe';

  // Contact
  if (/contact|message|inquiry|enquiry/i.test(html) ||
    /contact/i.test(actionLower) ||
    (fields.some(f => f.type === 'email') && fields.some(f => f.type === 'textarea'))
  ) return 'contact';

  // Checkout
  if (/checkout|payment|billing|shipping/i.test(html) ||
    /checkout/i.test(actionLower) ||
    fields.some(f => /card|cvv|expir/i.test(f.name))
  ) return 'checkout';

  return 'other';
}

function resolveAction(action: string, baseUrl: string): string {
  if (!action || action === '#') return baseUrl;
  try {
    return new URL(action, baseUrl).href;
  } catch {
    return action;
  }
}
