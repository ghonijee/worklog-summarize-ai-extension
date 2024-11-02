class PopupManager {
  constructor() {
    this.initializeEventListeners();
    this.loadAccounts();
    this.initializeDateDefaults();
  }

  initializeDateDefaults() {
    const today = new Date();
    const lastWeekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
    
    // Format dates for input elements (YYYY-MM-DD)
    const formatDate = (date) => date.toISOString().split('T')[0];
    
    document.getElementById('startDate').value = formatDate(lastWeekStart);
    document.getElementById('endDate').value = formatDate(today);
  }

  initializeEventListeners() {
    // Bind methods to preserve 'this' context
    this.generateResume = this.generateResume.bind(this);
    this.copyToClipboard = this.copyToClipboard.bind(this);
    this.handleDateChange = this.handleDateChange.bind(this);

    // Add event listeners
    document.getElementById('startDate').addEventListener('change', this.handleDateChange);
    document.getElementById('endDate').addEventListener('change', this.handleDateChange);
    document.getElementById('generateBtn').addEventListener('click', this.generateResume);
    document.getElementById('copyBtn').addEventListener('click', this.copyToClipboard);
    document.getElementById('openSettings').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  handleDateChange(e) {
    const startDate = new Date(document.getElementById('startDate').value);
    const endDate = new Date(document.getElementById('endDate').value);

    // Validate date range
    if (endDate < startDate) {
      alert('End date cannot be earlier than start date');
      e.target.value = e.target.defaultValue;
    }
  }

  async loadAccounts() {
    const accounts = await this.getStoredAccounts();
    const accountSelect = document.getElementById('accountSelect');
    const lastSelectedAccount = await this.getLastSelectedAccount();
    
    accountSelect.innerHTML = '<option value="">Select an account...</option>';
    accounts.forEach(account => {
      const option = document.createElement('option');
      option.value = account.id;
      option.textContent = account.name;
      if (lastSelectedAccount && account.id === lastSelectedAccount) {
        option.selected = true;
      }
      accountSelect.appendChild(option);
    });
  }

  async getStoredAccounts() {
    return new Promise((resolve) => {
      chrome.storage.local.get('jiraAccounts', (result) => {
        resolve(result.jiraAccounts || []);
      });
    });
  }

  async getCurrentAccount() {
    const accountId = document.getElementById('accountSelect').value;
    if (!accountId) {
      throw new Error('Please select an account');
    }

    const accounts = await this.getStoredAccounts();
    return accounts.find(account => account.id === accountId);
  }

  async generateResume() {
    try {
      const loadingIndicator = document.getElementById('loadingIndicator');
      loadingIndicator.style.display = 'flex';

      const account = await this.getCurrentAccount();
      if (!account) {
        throw new Error('Please select an account');
      }

      await this.saveLastSelectedAccount(account.id);

      const tokenLength = document.getElementById('tokenLength').value;
      const startDate = document.getElementById('startDate').value;
      const endDate = document.getElementById('endDate').value;

      const worklogs = await this.fetchJiraWorklogs(startDate, endDate, account);
      const resume = await this.generateResumeText(worklogs, tokenLength);
      
      document.getElementById('result').classList.remove('hidden');
      document.getElementById('resumeContent').textContent = resume;
      document.getElementById('rawDataContent').innerHTML = this.formatRawData(worklogs);

    } catch (error) {
      console.error('Error:', error);
    } finally {
      const loadingIndicator = document.getElementById('loadingIndicator');
      loadingIndicator.style.display = 'none';
    }
  }

  async fetchJiraWorklogs(startDate, endDate, account) {
    try {
      // Format dates for Jira API
      const formattedStartDate = new Date(startDate).toISOString().split('T')[0];
      const formattedEndDate = new Date(endDate).toISOString().split('T')[0];

      const jql = `worklogAuthor = currentUser() AND worklogDate >= "${formattedStartDate}" AND worklogDate <= "${formattedEndDate}" ORDER BY updated DESC`;
      
      const url = new URL('/rest/api/3/search', account.jiraUrl);
      url.searchParams.append('jql', jql);
      url.searchParams.append('fields', 'summary,worklog');
      url.searchParams.append('maxResults', '100');

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(`${account.email}:${account.token}`)}`,
          'X-Atlassian-Token': 'no-check',
          'Access-Control-Allow-Origin': '*'
        },
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to fetch worklogs (${response.status}): ${errorData.message || response.statusText}`
        );
      }

      const data = await response.json();
      
      // If no results found
      if (!data.issues || data.issues.length === 0) {
        return { issues: [] };
      }

      // Fetch detailed worklog information for each issue
      const detailedWorklogs = await Promise.all(
        data.issues.map(async (issue) => {
          const worklogUrl = new URL(
            `/rest/api/3/issue/${issue.key}/worklog`,
            account.jiraUrl
          );
          
          const worklogResponse = await fetch(worklogUrl.toString(), {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': `Basic ${btoa(`${account.email}:${account.token}`)}`,
              'X-Atlassian-Token': 'no-check'
            },
            credentials: 'include'
          });

          if (!worklogResponse.ok) {
            console.warn(`Failed to fetch worklog for issue ${issue.key}`);
            return issue;
          }

          const worklogData = await worklogResponse.json();
          
          // Filter worklogs to only include those within the date range
          const startDateTime = new Date(startDate);
          const endDateTime = new Date(endDate);
          endDateTime.setHours(23, 59, 59, 999); // Include the entire end date

          const filteredWorklogs = {
            ...worklogData,
            worklogs: worklogData.worklogs.filter(worklog => {
              const worklogDate = new Date(worklog.started);
              return worklogDate >= startDateTime && worklogDate <= endDateTime;
            })
          };

          return {
            ...issue,
            fields: {
              ...issue.fields,
              worklog: filteredWorklogs
            }
          };
        })
      );

      // Filter out issues that have no worklogs after date filtering
      const filteredIssues = detailedWorklogs.filter(
        issue => issue.fields.worklog.worklogs.length > 0
      );

      return {
        ...data,
        issues: filteredIssues
      };
    } catch (error) {
      console.error('Error fetching worklogs:', error);
      throw new Error(
        `Failed to fetch worklogs: ${error.message || 'Unknown error'}`
      );
    }
  }

  async generateResumeText(worklogs, tokenLength) {
    try {
      // Get OpenRouter API key from storage
      const apiKey = await this.getOpenRouterApiKey();
      if (!apiKey) {
        throw new Error('Please set your OpenRouter API key in the extension settings');
      }

      // Prepare worklogs data for the prompt
      const worklogsSummary = this.prepareWorklogsSummary(worklogs);
      
      // Create prompt based on token length
      const prompt = this.createPrompt(worklogsSummary, tokenLength);

      // Call OpenRouter API
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': chrome.runtime.getURL('/'),
          'X-Title': 'Jira Worklog Resume Generator'
        },
        body: JSON.stringify({
         model: "meta-llama/llama-3.2-3b-instruct:free",
          messages: [
            {
              role: 'system',
              content: 'You are a professional resume writer helping to summarize work activities.'
            },
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate resume with AI');
      }

      const data = await response.json();
      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('Resume generation error:', error);
      return `Error generating resume: ${error.message}`;
    }
  }

  prepareWorklogsSummary(worklogs) {
    return worklogs.issues?.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      worklogs: issue.fields.worklog.worklogs.map(log => ({
        timeSpent: this.formatTimeSpent(log.timeSpentSeconds),
        comment: this.extractCommentText(log.comment),
        started: new Date(log.started).toISOString().split('T')[0]
      }))
    }));
  }

  createPrompt(worklogsSummary, tokenLength) {
    const language = document.getElementById('language').value;
    const style = document.getElementById('style').value;
    
    const promptGuides = {
      small: {
        format: 'Create a concise weekly report summary',
        maxLength: '150 words',
        structure: `
          * Key accomplishments
          * Time allocation
          * Challenges`
      },
      medium: {
        format: 'Create a detailed weekly status report',
        maxLength: '300 words',
        structure: `
          * Overall progress
          * Tasks by category
          * Time allocation
          * Challenges and solutions
          * Next steps`
      },
      long: {
        format: 'Create a comprehensive progress report',
        maxLength: '500 words',
        structure: `
          * Executive summary
          * Detailed tasks breakdown
          * Time investment
          * Technical details
          * Ongoing work status
          * Dependencies
          * Risks and mitigations`
      }
    };

    const styleGuides = {
      professional: 'Use formal business language with clear, concise statements',
      casual: 'Use a conversational tone while maintaining professionalism',
      technical: 'Include technical details and specific terminology'
    };

    const languagePrompt = language === 'id' ? 
      'Write the response in Bahasa Indonesia using formal business language.' :
      'Write the response in English.';

    const guide = promptGuides[tokenLength];
    return `
    As a technical team member reporting to their manager, create a status report following these guidelines:

    Format: ${guide.format}
    Maximum Length: ${guide.maxLength}
    Language: ${languagePrompt}
    Writing Style: ${styleGuides[style]}
    Structure:${guide.structure}

    Work Activities to Report:
    ${JSON.stringify(worklogsSummary, null, 2)}

    Important:
    - Group related tasks together
    - Include time spent on each major area
    - Highlight specific accomplishments
    - Note any challenges encountered
    - Keep technical details clear
    - Focus on value delivered
    - Include specific metrics where available

    Format the response with clear sections:

    OVERVIEW:
    [Period accomplishments summary]

    TASKS AND DETAILS:
    [Tasks breakdown from worklogs comments]

    CHALLENGES:
    [Issues and solutions]

    NEXT STEPS:
    [Upcoming priorities]

    Use asterisks (*) for bullet points. Don't use any other formatting. Use spacing and line breaks for readability.
    `;
  }

  async getOpenRouterApiKey() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('openRouterApiKey', (result) => {
        const apiKey = result.openRouterApiKey;
        if (!apiKey) {
          reject(new Error('OpenRouter API key not found. Please set it in the extension settings.'));
        }
        resolve(apiKey);
      });
    });
  }

  formatRawData(worklogs) {
    const allWorklogs = [];
    const startDate = new Date(document.getElementById('startDate').value);
    const endDate = new Date(document.getElementById('endDate').value);
    endDate.setHours(23, 59, 59, 999);
    
    worklogs.issues?.forEach(issue => {
      const logs = issue.fields.worklog.worklogs;
      logs.forEach(log => {
        const logDate = new Date(log.started);
        if (logDate >= startDate && logDate <= endDate) {
          const comment = this.extractCommentText(log.comment);
          allWorklogs.push({
            issueKey: issue.key,
            summary: issue.fields.summary,
            timeSpent: this.formatTimeSpent(log.timeSpentSeconds),
            comment: comment,
            started: logDate
          });
        }
      });
    });

    allWorklogs.sort((a, b) => b.started - a.started);

    return allWorklogs.map(log => `
      <div class="worklog-item">
        <h3>${log.issueKey} [${log.timeSpent}]</h3>
        <p>${log.comment}</p>
      </div>
    `).join('') || 'No worklogs found';
  }

  extractCommentText(comment) {
    if (!comment) return 'No comment';
    
    // Handle plain text comments
    if (typeof comment === 'string') return comment;
    
    // Handle Atlassian Document format
    if (comment.content) {
      return comment.content
        .map(item => {
          if (item.type === 'paragraph') {
            return item.content
              ?.map(content => content.text || '')
              .filter(Boolean)
              .join(' ');
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    
    return 'No comment';
  }

  formatTimeSpent(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  copyToClipboard() {
    const resumeContent = document.getElementById('resumeContent').textContent;
    navigator.clipboard.writeText(resumeContent)
      .then(() => alert('Resume copied to clipboard!'))
      .catch(err => console.error('Failed to copy text:', err));
  }

  async getLastSelectedAccount() {
    return new Promise((resolve) => {
      chrome.storage.local.get('lastSelectedAccount', (result) => {
        resolve(result.lastSelectedAccount || '');
      });
    });
  }

  async saveLastSelectedAccount(accountId) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ lastSelectedAccount: accountId }, resolve);
    });
  }
}

// Initialize the popup manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});