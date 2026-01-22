create table product_categories (
  product_category_id text primary key,    -- UUID
  category_name text
);

create table users (
  user_id text primary key,    -- UUID
  username text,
  email text,
  default_currency text,
  is_active boolean
);

create table payment_modes (
  payment_mode_id text primary key,    -- UUID
  payment_mode_name text
);


create table products (
  product_id text primary key,     -- UUID
  product_name text,
  std_metric text,
  product_category_id text,
  foreign key (product_category_id) references product_categories(product_category_id)
);

create table stores (
  store_id text primary key,    -- UUID
  -- product_category_id text,
  store_name text,
  -- foreign key (product_category_id) references (product_categories)
);



