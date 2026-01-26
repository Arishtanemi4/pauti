import React, { useState } from 'react';
import Navbar from '../components/Navbar';
import ExpenseCard from '../components/ExpenseCard';

const Dashboard = () => {
  // useState for managing local list of expenses
  const [expenses, setExpenses] = useState([
    { id: 1, title: 'Grocery Run', amount: 45.50, date: '2023-10-24', category: 'Food' },
    { id: 2, title: 'Uber Trip', amount: 12.00, date: '2023-10-23', category: 'Transport' },
    { id: 3, title: 'Coffee', amount: 4.50, date: '2023-10-23', category: 'Dining' },
  ]);

  const containerStyle = {
    padding: '2rem',
    maxWidth: '800px',
    margin: '0 auto',
    minHeight: '100vh'
  };

  return (
    <>
      <Navbar />
      <div style={containerStyle}>
        <h1 style={{ borderBottom: '1px solid var(--text-secondary)', paddingBottom: '1rem' }}>
          Recent Activity
        </h1>
        
        {/* Render List Componentized */}
        <div>
          {expenses.map((expense) => (
            <ExpenseCard key={expense.id} expense={expense} />
          ))}
        </div>
      </div>
    </>
  );
};

export default Dashboard;