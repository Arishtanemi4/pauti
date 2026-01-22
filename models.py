# app/models.py
from sqlalchemy import Column, Integer, String, Float, Date, DateTime
from sqlalchemy.sql import func
from .database import Base

import uuid
import enum
from datetime import datetime
from sqlalchemy import (Column, String, Integer, Float, Boolean, Date, DateTime, ForeignKey, Enum, Text)
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy import create_engine

# 1. Setup Database Connection (SQLite for local usage)
DATABASE_URL = "sqlite:///./pauti.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
Base = declarative_base()

# Enums for data consistency
class SourceType(enum.Enum):
    MANUAL = "MANUAL"
    OCR = "OCR"
    BANK_STMT = "BANK_STMT"


# --- MASTER TABLES (Prefixes Removed) ---

class User(Base):
    __tablename__ = "users"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, index=True) # e.g., 'kaustubh'
    email = Column(String, unique=True, nullable=True)
    default_currency = Column(String, default="GBP")
    is_active = Column(Boolean, default=True)
    
    # Relationships
    transactions_paid = relationship("TransactionHeader", back_populates="payer")
    splits_owed = relationship("ExpenseSplit", back_populates="debtor")


class ProductCategory(Base):
    __tablename__ = "product_categories"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True) # e.g., 'groceries', 'junk', 'travel'
    
    products = relationship("Product", back_populates="category")
    stores = relationship("Store", back_populates="default_category")


class PaymentMode(Base):
    __tablename__ = "payment_modes"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True) # e.g., 'cash', 'niyo', 'sbi'
    
    transactions = relationship("TransactionHeader", back_populates="payment_mode")


class Store(Base):
    __tablename__ = "stores"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, index=True) # e.g., 'lidl', 'gogo pizza'
    logo_url = Column(String, nullable=True)
    
    # If a store is almost always one category (e.g., Uber = Travel), set a default
    default_category_id = Column(String, ForeignKey("product_categories.id"), nullable=True)
    
    default_category = relationship("ProductCategory", back_populates="stores")
    transactions = relationship("TransactionHeader", back_populates="store")


class Product(Base):
    __tablename__ = "products"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, index=True) # e.g., 'milk', 'deep pan pizza'
    std_metric = Column(String) # e.g., 'unit', 'kg', 'litre'
    
    category_id = Column(String, ForeignKey("product_categories.id"))
    
    category = relationship("ProductCategory", back_populates="products")
    transaction_lines = relationship("TransactionLine", back_populates="product")


# --- INCREMENTAL / TRANSACTIONAL TABLES ---

class TransactionHeader(Base):
    """
    Represents the receipt header or a single bank statement row.
    """
    __tablename__ = "transactions_header"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    date = Column(Date, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Foreign Keys
    store_id = Column(String, ForeignKey("stores.id"), nullable=True)
    payer_user_id = Column(String, ForeignKey("users.id"))
    payment_mode_id = Column(String, ForeignKey("payment_modes.id"))
    
    # Financials
    total_amount_gbp = Column(Float, nullable=False)
    total_amount_inr = Column(Float, nullable=True)
    exchange_rate = Column(Float, default=1.0)
    
    # Metadata
    source_type = Column(Enum(SourceType), default=SourceType.MANUAL)
    source_reference = Column(String, nullable=True) # e.g., filename
    is_reconciled = Column(Boolean, default=False)   # Matched bank stmt with receipt?
    
    # Relationships
    store = relationship("Store", back_populates="transactions")
    payer = relationship("User", back_populates="transactions_paid")
    payment_mode = relationship("PaymentMode", back_populates="transactions")
    lines = relationship("TransactionLine", back_populates="header", cascade="all, delete-orphan")


class TransactionLine(Base):
    """
    Represents specific items inside a transaction.
    """
    __tablename__ = "transaction_lines"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    txn_id = Column(String, ForeignKey("transactions_header.id"))
    
    # Product Details
    product_id = Column(String, ForeignKey("products.id"), nullable=True)
    product_name_raw = Column(String) # Text from OCR if product not in DB yet
    
    # Quantities
    quantity = Column(Float, default=1.0)
    metric = Column(String) # gm, ml, unit
    unit_price = Column(Float, nullable=True)
    line_total_gbp = Column(Float)
    
    description = Column(Text, nullable=True) # Line-specific comment
    
    # Relationships
    header = relationship("TransactionHeader", back_populates="lines")
    product = relationship("Product", back_populates="transaction_lines")
    splits = relationship("ExpenseSplit", back_populates="line", cascade="all, delete-orphan")


class ExpenseSplit(Base):
    """
    Splitwise Logic: Links a specific line item to the person who owes money for it.
    """
    __tablename__ = "expense_splits"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    line_id = Column(String, ForeignKey("transaction_lines.id"))
    debtor_user_id = Column(String, ForeignKey("users.id")) # Who owes the money
    
    owed_amount_gbp = Column(Float)
    is_settled = Column(Boolean, default=False)
    
    # Relationships
    line = relationship("TransactionLine", back_populates="splits")
    debtor = relationship("User", back_populates="splits_owed")


# --- INITIALIZATION SCRIPT ---

def init_db():
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("Tables created successfully in 'pauti.db'")

if __name__ == "__main__":
    init_db()