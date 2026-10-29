/** Masks a bank-account number for display: only the last four digits are shown (VP-182). */
export function maskAccount(accountNumber: string): string {
  return `**** ${accountNumber.slice(-4)}`;
}

/** Formats paise as an INR amount string, e.g. 85000000 -> "8,50,000.00". */
export function formatInr(amountMinor: number): string {
  const rupees = amountMinor / 100;
  return rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
