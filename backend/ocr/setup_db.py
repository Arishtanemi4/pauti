import __init__ as init
import logging
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

# --- CONFIGURATION ---
DB_NAME = init.dbname
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ==========================================
# 1. DATABASE SETUP (Same as before)
# ==========================================
Base = declarative_base()

class ReceiptDB(Base):
    __tablename__ = init.tables["reciepts"]
    id = Column(Integer, primary_key=True)
    merchant_name = Column(String)
    transaction_date = Column(Date)
    total_amount = Column(Float)
    items = relationship("LineItemDB", back_populates=init.tables["reciepts"], cascade="all, delete-orphan")

class LineItemDB(Base):
    __tablename__ = init.tables["line_item"]
    id = Column(Integer, primary_key=True)
    receipt_id = Column(Integer, ForeignKey('receipts.id'))
    description = Column(String)
    price = Column(Float)
    receipt = relationship("ReceiptDB", back_populates="items")

engine = create_engine(f'sqlite:///{DB_NAME}')
Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
