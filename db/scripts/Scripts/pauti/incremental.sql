drop table if exists transaction_header;
create table transaction_header (
  trxn_id text primary key,
  payer_user_id text,
  store_id text,
  payment_mode_id text,
  trxn_date date,
  total_amount integer,
  currency text,
  source_type text,
  source_reference text,
  is_reconciled boolean,
  foreign key (payer_user_id) references users(user_id),
  foreign key (store_id) references stores(store_id),
  foreign key (payment_mode_id) references payment_modes(payment_mode_id)
);


drop table if exists transaction_lines;
create table transaction_lines (
  line_id text primary key,
  trxn_id text,
  product_id text,
  product_name text,
  quantity integer,
  metric text,
  unit_price integer,
  line_amount integer,
  foreign key (trxn_id) references transaction_header(trxn_id),
  foreign key (product_id) references products(product_id)
);


drop table if exists expense_splits;
create table expense_splits (
  split_id text primary key,
  trxn_id text,
  line_id text,
  debtor_id text,
  owned_amount integer,
  currency text,
  is_settled boolean,
  foreign key (trxn_id) references transaction_header(trxn_id),
  foreign key (line_id) references transaction_lines(line_id),
  foreign key (debtor_id) references users(user_id)
);
