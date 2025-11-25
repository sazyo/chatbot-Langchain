import React from 'react';
import ChatInterface from './components/ChatInterface';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="app-header">
        <h1>AI Assistant</h1>
        <p>Ask me anything about Apple Inc. or general questions</p>
      </header>
      <ChatInterface />
    </div>
  );
}

export default App;