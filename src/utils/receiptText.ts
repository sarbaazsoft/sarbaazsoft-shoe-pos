import { formatStockPrice } from './priceFormat.ts';

// 1. Generate WhatsApp Receipt Text
export function buildWhatsAppInvoiceText(sale: any, companySettings: any): string {
  const storeName =
    companySettings?.name ||
    companySettings?.company_name ||
    companySettings?.companyName ||
    'Retail Store';
  const phone = companySettings?.phone || '';
  const currency = companySettings?.currency_symbol || companySettings?.currencySymbol || 'Rs.';
  const rawFooter = companySettings?.invoice_footer || companySettings?.invoiceFooter || 'Thank you for shopping with us!';
  const footerNote = rawFooter
    .replace(/Powered by\s+SarbaazSoft Shoe POS[\s•·-]*©?\s*20\d\d\s*All rights reserved\.?/gi, '')
    .replace(/Powered by\s+SarbaazSoft Shoe POS/gi, '')
    .replace(/SarbaazSoft Shoe POS/gi, '')
    .replace(/SarbaazSoft POS/gi, '')
    .replace(/(©|&copy;)?\s*20\d\d\s*All rights reserved\.?/gi, '')
    .replace(/Powered by[\s\S]*$/gi, '')
    .trim() || 'Thank you for shopping with us!';

  const items = sale.items || [];
  const itemsText = items
    .map((item: any) => {
      const name = item.article || item.product_name || item.name;
      const qty = item.quantity;
      const unitPrice = formatStockPrice(item.unit_price || 0);
      const total = formatStockPrice(item.subtotal || 0);
      return `• *${name}* (${qty}x @ ${currency} ${unitPrice}) = *${currency} ${total}*`;
    })
    .join('\n');

  const subtotal = parseFloat(sale.subtotal || 0);
  const discount = parseFloat(sale.discount || 0);
  const exchangeCredit = parseFloat(sale.exchange_credit || 0);
  const itemsSubtotal = items.reduce((acc: number, it: any) => acc + (parseFloat(it.subtotal || (it.quantity * it.unit_price)) || 0), 0);
  const currentItemsTotal = Math.max(0, (subtotal > 0 ? subtotal : itemsSubtotal) - discount);
  const previousBalance = parseFloat(sale.previous_balance || 0);
  const grandTotalDue = Math.round((currentItemsTotal + previousBalance) * 100) / 100;
  const paidAmount = parseFloat(sale.paid_amount ?? sale.cash_received ?? grandTotalDue);
  const remainingBalance = parseFloat(sale.remaining_balance ?? Math.max(0, grandTotalDue - paidAmount));
  const changeGiven = parseFloat(sale.change_given || (paidAmount > grandTotalDue ? paidAmount - grandTotalDue : 0));

  const isWholesale = String(sale.sale_type || sale.saleType || companySettings?.businessType || companySettings?.business_type || '').toUpperCase() === 'WHOLESALE';

  let message = `🛍️ *${storeName}* - Digital Receipt\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `🧾 Invoice: *${sale.invoice_number}*\n`;
  message += `📅 Date: ${sale.sale_date || ''}\n`;
  if (sale.customer_name) message += `👤 Customer: *${sale.customer_name}*\n`;
  if (sale.cashier_name) message += `🏷️ Cashier: ${sale.cashier_name}\n`;
  message += `💳 Payment: *${sale.payment_method || 'CASH'}*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `*Purchased Footwear:*\n${itemsText}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  if (discount > 0) message += `💰 Discount: -${currency} ${formatStockPrice(discount)}\n`;
  if (exchangeCredit > 0) {
    if (isWholesale) {
      message += `🔄 Return Credit: -${currency} ${formatStockPrice(exchangeCredit)}\n`;
      if (sale.return_number) message += `📑 Return #: ${sale.return_number}\n`;
    } else {
      message += `🔄 Exchange Credit: -${currency} ${formatStockPrice(exchangeCredit)}\n`;
      if (sale.return_number) message += `📑 Exchange Return #: ${sale.return_number}\n`;
    }
  }
  if (previousBalance !== 0) {
    message += `📋 Previous Khata Balance: ${currency} ${formatStockPrice(previousBalance)}\n`;
    message += `📦 Current Items Total: ${currency} ${formatStockPrice(currentItemsTotal)}\n`;
  }
  message += `⭐ *GRAND TOTAL DUE: ${currency} ${formatStockPrice(grandTotalDue)}*\n`;
  message += `💵 Amount Paid: ${currency} ${formatStockPrice(paidAmount)}\n`;
  if (remainingBalance > 0) {
    message += `🔴 *Balance Carried Forward: ${currency} ${formatStockPrice(remainingBalance)}*\n`;
  } else if (changeGiven > 0) {
    message += `🪙 Change Returned: ${currency} ${formatStockPrice(changeGiven)}\n`;
  }
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `${footerNote} 🙏\n`;
  if (phone) message += `📞 Store Contact: ${phone}\n`;

  return message;
}

// 2. Generate SMS Receipt Text (Concise, high-deliverability format)
export function buildSmsInvoiceText(sale: any, companySettings: any): string {
  const storeName =
    companySettings?.name ||
    companySettings?.company_name ||
    companySettings?.companyName ||
    'Retail Store';
  const phone = companySettings?.phone || '';
  const currency = companySettings?.currency_symbol || companySettings?.currencySymbol || 'Rs.';
  const rawFooter = companySettings?.invoice_footer || companySettings?.invoiceFooter || 'Thank you for shopping with us!';
  const footerNote = rawFooter
    .replace(/Powered by\s+SarbaazSoft Shoe POS[\s•·-]*©?\s*20\d\d\s*All rights reserved\.?/gi, '')
    .replace(/Powered by\s+SarbaazSoft Shoe POS/gi, '')
    .replace(/SarbaazSoft Shoe POS/gi, '')
    .replace(/SarbaazSoft POS/gi, '')
    .replace(/(©|&copy;)?\s*20\d\d\s*All rights reserved\.?/gi, '')
    .replace(/Powered by[\s\S]*$/gi, '')
    .trim() || 'Thank you for shopping with us!';

  const items = sale.items || [];
  const itemsSummary = items
    .map((item: any) => {
      const name = item.article || item.product_name || item.name || 'Shoe';
      const qty = item.quantity;
      const total = formatStockPrice(item.subtotal || 0);
      return `${name} (${qty}x)=${currency}${total}`;
    })
    .join(', ');

  const subtotal = parseFloat(sale.subtotal || 0);
  const discount = parseFloat(sale.discount || 0);
  const exchangeCredit = parseFloat(sale.exchange_credit || 0);
  const itemsSubtotal = items.reduce((acc: number, it: any) => acc + (parseFloat(it.subtotal || (it.quantity * it.unit_price)) || 0), 0);
  const currentItemsTotal = Math.max(0, (subtotal > 0 ? subtotal : itemsSubtotal) - discount);
  const previousBalance = parseFloat(sale.previous_balance || 0);
  const grandTotalDue = Math.round((currentItemsTotal + previousBalance) * 100) / 100;
  const paidAmount = parseFloat(sale.paid_amount ?? sale.cash_received ?? grandTotalDue);
  const remainingBalance = parseFloat(sale.remaining_balance ?? Math.max(0, grandTotalDue - paidAmount));
  const isWholesale = String(sale.sale_type || sale.saleType || companySettings?.businessType || companySettings?.business_type || '').toUpperCase() === 'WHOLESALE';

  let sms = `${storeName} Receipt\n`;
  sms += `Inv: ${sale.invoice_number} | ${sale.sale_date || ''}\n`;
  if (sale.customer_name) sms += `Cust: ${sale.customer_name}\n`;
  sms += `Items: ${itemsSummary}\n`;
  if (discount > 0) sms += `Disc: -${currency}${formatStockPrice(discount)}\n`;
  if (exchangeCredit > 0) {
    if (isWholesale) {
      sms += `Return Credit: -${currency}${formatStockPrice(exchangeCredit)}\n`;
    } else {
      sms += `Exch Credit: -${currency}${formatStockPrice(exchangeCredit)}\n`;
    }
  }
  if (previousBalance !== 0) sms += `Prev Bal: ${currency}${formatStockPrice(previousBalance)} | Items: ${currency}${formatStockPrice(currentItemsTotal)}\n`;
  sms += `Total Due: ${currency}${formatStockPrice(grandTotalDue)} | Paid: ${currency}${formatStockPrice(paidAmount)}\n`;
  if (remainingBalance > 0) sms += `Khata Bal: ${currency}${formatStockPrice(remainingBalance)}\n`;
  sms += `${footerNote}`;
  if (phone) sms += ` | Tel: ${phone}`;

  return sms;
}

/**
 * Generates an SMS link compatible with iOS, Android, and desktop messaging clients.
 */
export function buildSmsLink(phone: string, text: string): string {
  const cleanPhone = phone ? phone.trim().replace(/[\s\-\(\)]/g, '') : '';
  const isApple = typeof navigator !== 'undefined' && /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
  const separator = isApple ? '&' : '?';
  const encodedText = encodeURIComponent(text);
  return cleanPhone ? `sms:${cleanPhone}${separator}body=${encodedText}` : `sms:${separator}body=${encodedText}`;
}

/**
 * Generates a WhatsApp link compatible with WhatsApp Web and mobile WhatsApp app.
 */
export function buildWhatsAppLink(phone: string, text: string): string {
  let cleanPhone = phone ? phone.replace(/[^0-9]/g, '') : '';
  if (cleanPhone.startsWith('00')) {
    cleanPhone = cleanPhone.substring(2);
  } else if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
    cleanPhone = '92' + cleanPhone.substring(1);
  }
  const encodedText = encodeURIComponent(text);
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encodedText}`;
  }
  return `https://api.whatsapp.com/send?text=${encodedText}`;
}
