import os
import uuid
from sqlalchemy import Column, String, Integer, Boolean, Date, ForeignKey, Text
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy import create_engine
import dotenv

dotenv.load_dotenv()  # Load environment variables from .env file if it exists


DB_PATH = os.getenv("DB_PATH")  # Default to 'app.db' if not set
DATABASE_URL = f"sqlite:///{DB_PATH}"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
Base = declarative_base()

# --- HELPER FUNCTION FOR PREFIXED IDs ---
def generate_id(prefix):
    """
    Generates a UUID with a readable prefix.
    Example: generate_id('usr') -> 'usr_550e8400-e29b-41d4...'
    """
    return f"{prefix}_{str(uuid.uuid4())}"


# --- MASTER TABLES ---

class Category(Base):
    __tablename__ = "categories"
    
    # Prefix: cat_
    category_id = Column(Text, primary_key=True, default=lambda: generate_id("cat"))
    category_name = Column(Text)
    category_type = Column(Text)
    
    products = relationship("Product", back_populates="category")
    stores = relationship("Store", back_populates="category")


class User(Base):
    __tablename__ = "users"
    
    # Prefix: usr_
    user_id = Column(Text, primary_key=True, default=lambda: generate_id("usr"))
    username = Column(Text)
    email = Column(Text)
    firstname = Column(Text)
    lastname = Column(Text)
    contact_number = Column(Text)
    default_currency = Column(Text)
    is_active = Column(Boolean, default=True)
    
    transactions_paid = relationship("TransactionHeader", back_populates="payer")
    debt_splits = relationship("ExpenseSplit", back_populates="debtor")


class PaymentMode(Base):
    __tablename__ = "payment_modes"
    
    # Prefix: pay_
    payment_mode_id = Column(Text, primary_key=True, default=lambda: generate_id("pay"))
    payment_mode_name = Column(Text)
    
    transactions = relationship("TransactionHeader", back_populates="payment_mode")


class Product(Base):
    __tablename__ = "products"
    
    # Prefix: prod_
    product_id = Column(Text, primary_key=True, default=lambda: generate_id("prod"))
    product_category_id = Column(Text, ForeignKey("categories.category_id"))
    product_name = Column(Text)
    std_metric = Column(Text)
    
    category = relationship("Category", back_populates="products")
    transaction_lines = relationship("TransactionLine", back_populates="product")


class Store(Base):
    __tablename__ = "stores"
    
    # Prefix: sto_ (Using 'sto' to avoid confusion with 'str'/String)
    store_id = Column(Text, primary_key=True, default=lambda: generate_id("sto"))
    store_category_id = Column(Text, ForeignKey("categories.category_id"), nullable=True)
    store_name = Column(Text)
    
    category = relationship("Category", back_populates="stores")
    transactions = relationship("TransactionHeader", back_populates="store")


# --- TRANSACTION TABLES ---

class TransactionHeader(Base):
    __tablename__ = "transaction_header"
    
    # Prefix: txn_
    trxn_id = Column(Text, primary_key=True, default=lambda: generate_id("txn"))
    payer_user_id = Column(Text, ForeignKey("users.user_id"))
    store_id = Column(Text, ForeignKey("stores.store_id"))
    payment_mode_id = Column(Text, ForeignKey("payment_modes.payment_mode_id"))
    
    trxn_date = Column(Date)
    total_amount = Column(Integer)
    currency = Column(Text)
    source_type = Column(Text)
    source_reference = Column(Text)
    is_reconciled = Column(Boolean, default=False)
    
    payer = relationship("User", back_populates="transactions_paid")
    store = relationship("Store", back_populates="transactions")
    payment_mode = relationship("PaymentMode", back_populates="transactions")
    lines = relationship("TransactionLine", back_populates="header", cascade="all, delete-orphan")
    splits = relationship("ExpenseSplit", back_populates="transaction", cascade="all, delete-orphan")


class TransactionLine(Base):
    __tablename__ = "transaction_lines"
    
    # Prefix: line_
    line_id = Column(Text, primary_key=True, default=lambda: generate_id("line"))
    trxn_id = Column(Text, ForeignKey("transaction_header.trxn_id"))
    product_id = Column(Text, ForeignKey("products.product_id"), nullable=True)
    
    product_name = Column(Text)
    quantity = Column(Integer)
    metric = Column(Text)
    unit_price = Column(Integer)
    line_amount = Column(Integer)
    
    header = relationship("TransactionHeader", back_populates="lines")
    product = relationship("Product", back_populates="transaction_lines")
    splits = relationship("ExpenseSplit", back_populates="line", cascade="all, delete-orphan")


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"
    
    # Prefix: splt_
    split_id = Column(Text, primary_key=True, default=lambda: generate_id("splt"))
    trxn_id = Column(Text, ForeignKey("transaction_header.trxn_id"), nullable=True)
    line_id = Column(Text, ForeignKey("transaction_lines.line_id"), nullable=True)
    debtor_id = Column(Text, ForeignKey("users.user_id"))
    
    owned_amount = Column(Integer)
    currency = Column(Text)
    is_settled = Column(Boolean, default=False)
    
    transaction = relationship("TransactionHeader", back_populates="splits")
    line = relationship("TransactionLine", back_populates="splits")
    debtor = relationship("User", back_populates="debt_splits")


def init_db():
    print("Creating tables with prefixed IDs...")
    Base.metadata.create_all(bind=engine)
    print("Tables created successfully.")


if __name__ == "__main__":
    init_db()