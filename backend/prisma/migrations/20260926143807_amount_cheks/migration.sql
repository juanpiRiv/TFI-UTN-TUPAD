
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_unit_price_non_negative" CHECK ("unit_price" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_non_negative" CHECK ("total_amount" >= 0);