from typing import List, Optional
from pydantic import BaseModel
from datetime import date

# --- SHARED BASES ---

class ExpenseSplitBase(BaseModel):
    debtor_id: str
    owned_amount: int # Amount in minor units (e.g. pence)
    currency: str = "GBP"
    is_settled: bool = False


class TransactionLineBase(BaseModel):
    product_id: Optional[str] = None
    product_name: str
    quantity: int = 1
    metric: str = "unit"
    unit_price: Optional[int] = None
    line_amount: int


class TransactionHeaderBase(BaseModel):
    payer_user_id: str
    store_id: str
    payment_mode_id: str
    trxn_date: date
    total_amount: int
    currency: str = "GBP"
    source_type: str = "MANUAL"
    source_reference: Optional[str] = None
    is_reconciled: bool = False


# --- CREATE MODELS (Inputs) ---

class ExpenseSplitCreate(ExpenseSplitBase):
    pass


class TransactionLineCreate(TransactionLineBase):
    # A line might come with specific splits attached to it (Receipt style)
    splits: List[ExpenseSplitCreate] = []


class TransactionCreate(TransactionHeaderBase):
    # A transaction comes with a list of lines
    lines: List[TransactionLineCreate] = []
    # And potentially splits on the total (Bank Stmt style)
    splits: List[ExpenseSplitCreate] = []


# --- RESPONSE MODELS (Outputs) ---

class ExpenseSplitResponse(ExpenseSplitBase):
    split_id: str
    class Config:
        from_attributes = True


class TransactionLineResponse(TransactionLineBase):
    line_id: str
    splits: List[ExpenseSplitResponse] = []
    class Config:
        from_attributes = True


class TransactionResponse(TransactionHeaderBase):
    trxn_id: str
    lines: List[TransactionLineResponse] = []
    splits: List[ExpenseSplitResponse] = []  # Header-level splits
    class Config:
        from_attributes = True