create table transaction_header (
  trxn_id text primary key,
  payer_user_id text,
  store_id text,
  payment_mode_id text,
  trxn_date date,
  total_amount integer,
  source_type text,
  source_reference text,
  is_reconciled boolean,
  foreign key (payer_user_id) references
)









