drop table if exists categories;
create table categories (
  category_id text primary key,    -- UUID
  category_name text,
  category_type text
);


drop table if exists users;
create table users (
  user_id text primary key,    -- UUID
  username text,
  email text,
  default_currency text,
  is_active boolean
);


drop table if exists payment_modes;
create table payment_modes (
  payment_mode_id text primary key,    -- UUID
  payment_mode_name text
);


drop table if exists products;
create table products (
  product_id text primary key,     -- UUID
  product_category_id text,
  product_name text,
  std_metric text,
  foreign key (product_category_id) references product_categories(category_id)
);


drop table if exists stores;
create table stores (
  store_id text primary key,    -- UUID
  store_category_id text,
  store_name text,
  foreign key (store_category_id) references categories(category_id)
);

