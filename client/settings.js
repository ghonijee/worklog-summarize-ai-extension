class AccountManager {
  constructor() {
    this.initializeEventListeners();
    this.loadAccounts();
    this.initializeApiSettings();
  }

  initializeEventListeners() {
    document.getElementById('addAccountForm').addEventListener('submit', (e) => this.handleAddAccount(e));
  }

  async loadAccounts() {
    const accounts = await this.getStoredAccounts();
    this.renderAccounts(accounts);
  }

  async getStoredAccounts() {
    return new Promise((resolve) => {
      chrome.storage.local.get('jiraAccounts', (result) => {
        resolve(result.jiraAccounts || []);
      });
    });
  }

  async saveAccounts(accounts) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ jiraAccounts: accounts }, resolve);
    });
  }

  async handleAddAccount(e) {
    e.preventDefault();
    
    const accountData = {
      id: Date.now().toString(),
      name: document.getElementById('accountName').value,
      email: document.getElementById('email').value,
      token: document.getElementById('token').value,
      jiraUrl: document.getElementById('jiraUrl').value
    };

    try {
      const accounts = await this.getStoredAccounts();
      accounts.push(accountData);
      await this.saveAccounts(accounts);
      
      this.showMessage('Account added successfully!', 'success');
      this.renderAccounts(accounts);
      e.target.reset();
    } catch (error) {
      this.showMessage('Error adding account', 'error');
    }
  }

  async handleDeleteAccount(accountId) {
    if (confirm('Are you sure you want to delete this account?')) {
      try {
        const accounts = await this.getStoredAccounts();
        const updatedAccounts = accounts.filter(account => account.id !== accountId);
        await this.saveAccounts(updatedAccounts);
        
        this.showMessage('Account deleted successfully!', 'success');
        this.renderAccounts(updatedAccounts);
      } catch (error) {
        this.showMessage('Error deleting account', 'error');
      }
    }
  }

  renderAccounts(accounts) {
    const accountsList = document.getElementById('accountsList');
    accountsList.innerHTML = accounts.length ? '' : '<p>No accounts added yet.</p>';

    accounts.forEach(account => {
      const accountElement = document.createElement('div');
      accountElement.className = 'account-card';
      accountElement.innerHTML = `
        <div class="account-info">
          <h4>${account.name}</h4>
          <p>Email: ${account.email}</p>
          <p>Jira URL: ${account.jiraUrl}</p>
        </div>
        <div class="account-actions">
          <button class="delete-btn" data-id="${account.id}">Delete</button>
        </div>
      `;

      accountElement.querySelector('.delete-btn').addEventListener('click', () => {
        this.handleDeleteAccount(account.id);
      });

      accountsList.appendChild(accountElement);
    });
  }

  showMessage(text, type) {
    const messageEl = document.getElementById('message');
    messageEl.textContent = text;
    messageEl.className = `message ${type}`;
    
    setTimeout(() => {
      messageEl.className = 'message hidden';
    }, 3000);
  }

  initializeApiSettings() {
    const apiForm = document.getElementById('apiSettingsForm');
    
    // Load existing API key
    chrome.storage.local.get('openRouterApiKey', (result) => {
      if (result.openRouterApiKey) {
        document.getElementById('openRouterKey').value = result.openRouterApiKey;
      }
    });

    // Handle form submission
    apiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const apiKey = document.getElementById('openRouterKey').value.trim();
      
      try {
        await chrome.storage.local.set({ openRouterApiKey: apiKey });
        this.showMessage('API key saved successfully!', 'success');
      } catch (error) {
        this.showMessage('Failed to save API key: ' + error.message, 'error');
      }
    });
  }
}

// Initialize the account manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new AccountManager();
}); 