/**
 * eExact XML generator for Exact Globe invoice import.
 *
 * Produces a sales invoice (type "V") in the eExact XML format that can be
 * imported directly into Exact Globe via the XML import mechanism.
 */

export interface InvoiceXmlData {
  invoiceNumber: string;
  invoiceDate: string; // ISO date "2026-04-08"
  supplier: {
    code: string; // debtor code e.g. "PCFUP"
    name: string;
  };
  items: Array<{
    articleCode: string; // "2907" or "2908"
    description: string;
    quantity: number;
    unitPrice: number; // in EUR
    totalPrice: number; // in EUR
    vatCode: string; // "2" for 21% NL
  }>;
}

/**
 * Escape XML special characters to prevent malformed output or injection.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format a number to 2 decimal places with dot separator (XML/eExact standard).
 */
function formatDecimal(value: number): string {
  return value.toFixed(2);
}

/**
 * Generate eExact XML for Exact Globe invoice import.
 *
 * - Journal code "70" = standard sales journal
 * - Type "V" = Verkoopfactuur (sales invoice)
 * - VAT code "2" = 21% NL high tariff
 * - Currency: EUR
 * - Line numbers start at 1
 */
export function generateExactXml(data: InvoiceXmlData): string {
  const invoiceLines = data.items
    .map((item, index) => {
      const lineNumber = index + 1;
      return `      <InvoiceLine number="${lineNumber}">
        <Item code="${escapeXml(item.articleCode)}"/>
        <Description>${escapeXml(item.description)}</Description>
        <Quantity>${formatDecimal(item.quantity)}</Quantity>
        <Price type="S">
          <Currency code="EUR"/>
          <Value>${formatDecimal(item.unitPrice)}</Value>
          <VAT code="${escapeXml(item.vatCode)}"/>
        </Price>
        <Amount>
          <Currency code="EUR"/>
          <Value>${formatDecimal(item.totalPrice)}</Value>
        </Amount>
      </InvoiceLine>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<eExact xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:noNamespaceSchemaLocation="eExact-Schema.xsd">
  <Invoices>
    <Invoice type="V">
      <Journal code="70"/>
      <InvoiceNumber>${escapeXml(data.invoiceNumber)}</InvoiceNumber>
      <InvoiceDate>${escapeXml(data.invoiceDate)}</InvoiceDate>
      <OrderedBy>
        <Debtor code="${escapeXml(data.supplier.code)}" name="${escapeXml(data.supplier.name)}"/>
      </OrderedBy>
      <InvoiceTo>
        <Debtor code="${escapeXml(data.supplier.code)}" name="${escapeXml(data.supplier.name)}"/>
      </InvoiceTo>
${invoiceLines}
    </Invoice>
  </Invoices>
</eExact>`;
}
