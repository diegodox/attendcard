class AttendanceApp {
    constructor() {
        this.ws = null;
        this.data = null;
        this.currentMobileIndex = 0;
        this.init();
    }

    init() {
        this.setupWebSocket();
        this.loadWeekData();
        this.setupMobileSwipe();
    }

    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
        };
        
        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'weekly_update') {
                this.data = message.data;
                this.renderWeekDays();
            } else if (message.type === 'auto_reset') {
                alert(message.message);
            }
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected, reconnecting...');
            setTimeout(() => this.setupWebSocket(), 3000);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }





    showAddMemberDialog() {
        const name = prompt('新しいメンバーの名前を入力してください:');
        if (name && name.trim()) {
            this.addMember(name.trim());
        }
    }

    async addMember(name) {
        try {
            const response = await fetch('/api/members', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name }),
            });
            
            if (!response.ok) {
                throw new Error('Failed to add member');
            }
            
            // データは WebSocket 経由で更新される
        } catch (error) {
            console.error('Failed to add member:', error);
            alert('メンバーの追加に失敗しました。もう一度お試しください。');
        }
    }

    deleteMember(memberId, memberName) {
        if (confirm(`「${memberName}」を削除しますか？\n\n削除すると出席履歴も全て削除されます。`)) {
            this.doDeleteMember(memberId);
        }
    }

    async doDeleteMember(memberId) {
        try {
            const response = await fetch(`/api/members/${memberId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error('Failed to delete member');
            }
            
            // データは WebSocket 経由で更新される
        } catch (error) {
            console.error('Failed to delete member:', error);
            alert('メンバーの削除に失敗しました。もう一度お試しください。');
        }
    }

    resetToday() {
        if (confirm('今日の出席状況をすべてリセットしますか？\n\n全員が未回答状態に戻ります。')) {
            this.doResetToday();
        }
    }

    async doResetToday() {
        try {
            const response = await fetch('/api/attendance/reset', {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error('Failed to reset attendance');
            }
            
            // No countdown timer to restart
            
            // Reload week data
            await this.loadWeekData();
        } catch (error) {
            console.error('Failed to reset attendance:', error);
            alert('リセットに失敗しました。もう一度お試しください。');
        }
    }

    async startCountdown() {
        // No longer needed - countdown display removed
    }

    updateCountdown() {
        // No longer needed - countdown display removed
    }

    getDayNames() {
        return ['月', '火', '水', '木', '金'];
    }

    getSinglePinClass(member) {
        if (member.originalStatus === member.defaultStatus) {
            // ユーザが明示的に選択した状態とデフォルトが一致 - ステータス別の色
            if (member.defaultStatus === 'attend') return 'pin-matched-attend';
            if (member.defaultStatus === 'absent') return 'pin-matched-absent';
            if (member.defaultStatus === null) return 'pin-matched-pending';
        } else {
            // デフォルト設定済みだが現在と違う
            if (member.defaultStatus === 'attend') return 'pin-default-attend';
            if (member.defaultStatus === 'absent') return 'pin-default-absent';
            if (member.defaultStatus === null) return 'pin-default-pending';
        }
    }

    getSinglePinIcon(member) {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pin-angle-fill" viewBox="0 0 16 16"><path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a6 6 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707s.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a6 6 0 0 1 1.013.16l3.134-3.133a3 3 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146"/></svg>';
    }

    getSinglePinTooltip(member) {
        if (member.originalStatus === member.defaultStatus) {
            return 'デフォルト設定済み（ユーザ選択と一致）';
        } else {
            let defaultText;
            if (member.defaultStatus === 'attend') defaultText = '参加';
            else if (member.defaultStatus === 'absent') defaultText = '欠席';
            else defaultText = '未回答';
            
            let currentText;
            if (member.originalStatus === 'attend') currentText = '参加';
            else if (member.originalStatus === 'absent') currentText = '欠席';
            else currentText = '未回答';
            
            return `デフォルト：${defaultText}（${currentText}をデフォルトに設定）`;
        }
    }

    async loadWeekData() {
        try {
            const response = await fetch('/api/attendance/week');
            this.data = await response.json();
            this.renderWeekDays();
        } catch (error) {
            console.error('Failed to load week data:', error);
            // Fallback to empty data structure
            this.data = {
                members: [],
                weekData: {}
            };
            // Initialize empty week structure
            const dayNames = this.getDayNames();
            dayNames.forEach(dayName => {
                this.data.weekData[dayName] = {
                    day: dayName,
                    members: []
                };
            });
            this.renderWeekDays();
        }
    }

    renderWeekDays() {
        // Use requestIdleCallback for heavy DOM operations
        if (window.requestIdleCallback) {
            window.requestIdleCallback(() => {
                this.performRender();
            }, { timeout: 100 });
        } else {
            // Fallback for browsers that don't support requestIdleCallback
            setTimeout(() => this.performRender(), 0);
        }
    }

    performRender() {
        // Save scroll positions before re-rendering
        this.saveScrollPositions();
        
        this.renderDesktop();
        this.renderMobile();
        
        // Restore scroll positions after re-rendering
        requestAnimationFrame(() => this.restoreScrollPositions());
    }

    saveScrollPositions() {
        this.scrollPositions = {};
        
        // Use more efficient querying and reduce DOM access
        const saveCardPositions = (selector, prefix) => {
            const cards = document.querySelectorAll(selector);
            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                const container = card.querySelector('.members-container');
                if (container) {
                    const header = card.querySelector('.header h1');
                    const dayKey = header ? `${prefix}-${header.textContent.trim()}` : `${prefix}-${i}`;
                    this.scrollPositions[dayKey] = container.scrollTop;
                }
            }
        };
        
        saveCardPositions('#attendCards .attend-card', 'desktop');
        saveCardPositions('.mobile-card .attend-card', 'mobile');
    }

    restoreScrollPositions() {
        if (!this.scrollPositions) return;
        
        // Use more efficient restoration method
        const restoreCardPositions = (selector, prefix) => {
            const cards = document.querySelectorAll(selector);
            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                const container = card.querySelector('.members-container');
                if (container) {
                    const header = card.querySelector('.header h1');
                    const dayKey = header ? `${prefix}-${header.textContent.trim()}` : `${prefix}-${i}`;
                    const savedPosition = this.scrollPositions[dayKey];
                    if (savedPosition !== undefined) {
                        container.scrollTop = savedPosition;
                    }
                }
            }
        };
        
        restoreCardPositions('#attendCards .attend-card', 'desktop');
        restoreCardPositions('.mobile-card .attend-card', 'mobile');
    }

    renderDesktop() {
        const cardsContainer = document.getElementById('attendCards');
        const today = new Date().getDay(); // 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
        
        // Remove existing event listeners
        cardsContainer.removeEventListener('click', this.handleCardClick);
        
        // Add event listener for all buttons
        this.handleCardClick = this.handleCardClick.bind(this);
        cardsContainer.addEventListener('click', this.handleCardClick);
        
        // Get all 5 weekdays in chronological order
        const dayNames = this.getDayNames();
        const todayDate = new Date();
        const currentDay = todayDate.getDay(); // 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
        
        // Create ordered list of days starting from today
        let orderedDays = [];
        let tempDate = new Date(todayDate);
        let todayIndex = -1; // Index of today's card in the array
        
        // If weekend, start from next Monday
        if (currentDay === 0) { // Sunday
            tempDate.setDate(todayDate.getDate() + 1);
        } else if (currentDay === 6) { // Saturday  
            tempDate.setDate(todayDate.getDate() + 2);
        }
        
        // Collect 5 weekdays in order
        let collected = 0;
        while (collected < 5) {
            const dayOfWeek = tempDate.getDay();
            if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                const dayName = dayNames[dayOfWeek - 1];
                orderedDays.push(dayName);
                
                // Mark today's index for centering
                if (dayOfWeek === today) {
                    todayIndex = collected;
                }
                
                collected++;
            }
            tempDate.setDate(tempDate.getDate() + 1);
        }
        
        // If today is weekday, find today's index
        if (today >= 1 && today <= 5 && todayIndex === -1) {
            todayIndex = 0; // Today is the first card
        }
        
        
        cardsContainer.innerHTML = orderedDays.map((dayName, displayIndex) => {
            return this.generateCardHTML(dayName, today, dayNames);
        }).join('');
        
        // Center today's card by scrolling
        if (todayIndex >= 0) {
            setTimeout(() => {
                const todayCard = cardsContainer.children[todayIndex];
                if (todayCard) {
                    // Scroll to today's card
                    const cardWidth = 800;
                    const gap = 20;
                    const paddingElement = Math.max(0, (window.innerWidth / 2) - 400 - 20);
                    
                    // Calculate position including the ::before pseudo element
                    const scrollPosition = paddingElement + (todayIndex * (cardWidth + gap));
                    
                    cardsContainer.scrollTo({
                        left: scrollPosition,
                        behavior: 'smooth'
                    });
                }
            }, 100);
        }
        
        // Re-add event listener after DOM update
        cardsContainer.removeEventListener('click', this.handleCardClick);
        cardsContainer.addEventListener('click', this.handleCardClick);
    }

    renderMobile() {
        const mobileContainer = document.getElementById('mobileCardsWrapper');
        const indicatorContainer = document.getElementById('swipeIndicator');
        
        // Get ordered days
        const dayNames = this.getDayNames();
        const todayDate = new Date();
        const currentDay = todayDate.getDay();
        const today = currentDay;
        
        let orderedDays = [];
        let tempDate = new Date(todayDate);
        
        // If weekend, start from next Monday
        if (currentDay === 0) { // Sunday
            tempDate.setDate(todayDate.getDate() + 1);
        } else if (currentDay === 6) { // Saturday  
            tempDate.setDate(todayDate.getDate() + 2);
        }
        
        // Collect 5 weekdays in order
        let collected = 0;
        while (collected < 5) {
            const dayOfWeek = tempDate.getDay();
            if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                const dayName = dayNames[dayOfWeek - 1];
                orderedDays.push(dayName);
                collected++;
            }
            tempDate.setDate(tempDate.getDate() + 1);
        }

        // Render mobile cards
        mobileContainer.innerHTML = orderedDays.map((dayName, index) => {
            return `
                <div class="mobile-card">
                    ${this.generateCardHTML(dayName, today, dayNames)}
                </div>
            `;
        }).join('');

        // Render swipe indicators
        indicatorContainer.innerHTML = orderedDays.map((_, index) => {
            return `<div class="swipe-dot ${index === this.currentMobileIndex ? 'active' : ''}"></div>`;
        }).join('');

        // Remove existing mobile event listeners
        if (this.handleMobileCardClick) {
            mobileContainer.removeEventListener('click', this.handleMobileCardClick);
        }
        
        // Add event listeners to mobile cards
        this.handleMobileCardClick = this.handleMobileCardClick.bind(this);
        mobileContainer.addEventListener('click', this.handleMobileCardClick);

        // Re-apply scroll event handlers for members containers
        setTimeout(() => {
            const membersContainers = document.querySelectorAll('.mobile-card .members-container');
            membersContainers.forEach(container => {
                container.addEventListener('touchstart', (e) => {
                    e.stopPropagation();
                }, { passive: true });
                
                container.addEventListener('touchmove', (e) => {
                    e.stopPropagation();
                }, { passive: true });
            });
        }, 50);
    }

    generateCardHTML(dayName, today, dayNames) {
        const dayData = this.data.weekData[dayName];
        const dayIndex = dayNames.indexOf(dayName) + 1;
        const isToday = today === dayIndex;
        
        // Pre-calculate counts for efficiency
        let attendCount = 0, absentCount = 0, pendingCount = 0;
        dayData.members.forEach(m => {
            if (m.status === 'attend') attendCount++;
            else if (m.status === 'absent') absentCount++;
            else pendingCount++;
        });
        const totalCount = dayData.members.length;
        
        // Format date
        const dateObj = new Date(dayData.date);
        const formattedDate = dateObj.toLocaleDateString('ja-JP', {
            month: 'numeric',
            day: 'numeric',
            weekday: 'short'
        });

        // Pre-build member HTML fragments
        const memberFragments = dayData.members.map(member => {
            const cardClass = member.status ? 
                (member.status === 'attend' ? 'attending' : 'absent') : '';
            
            const statusClass = member.status ? 
                (member.status === 'attend' ? 'status-attend' : 'status-absent') : 
                'status-pending';

            return `<div class="member-card ${cardClass}">
                <div class="member-info">
                    <span class="status-indicator ${statusClass}"></span>
                    <span class="member-name">${member.name}</span>
                </div>
                <div class="member-buttons">
                    <button class="btn-pin ${this.getSinglePinClass(member)}" data-day="${dayName}" data-member-id="${member.id}" data-action="pin-current" title="${this.getSinglePinTooltip(member)}">
                        ${this.getSinglePinIcon(member)}
                    </button>
                    <button class="btn btn-attend ${member.originalStatus === 'attend' ? 'active' : ''}" data-day="${dayName}" data-member-id="${member.id}" data-action="attend">
                        ✓ 参加
                    </button>
                    <button class="btn btn-absent ${member.originalStatus === 'absent' ? 'active' : ''}" data-day="${dayName}" data-member-id="${member.id}" data-action="absent">
                        ✗ 欠席
                    </button>
                    <button class="btn-delete" data-member-id="${member.id}" data-member-name="${member.name}" data-action="delete" title="メンバーを削除">
                        🗑️
                    </button>
                </div>
            </div>`;
        });

        return `<div class="attend-card ${isToday ? 'today' : ''}">
            <div class="header">
                <div class="header-top">
                    <h1>📋 ${formattedDate}</h1>
                </div>
            </div>
            <div class="summary">
                <div class="summary-item attend">
                    <div class="summary-number">${attendCount}</div>
                    <div class="summary-label">参加</div>
                </div>
                <div class="summary-item absent">
                    <div class="summary-number">${absentCount}</div>
                    <div class="summary-label">欠席</div>
                </div>
                <div class="summary-item pending">
                    <div class="summary-number">${pendingCount}</div>
                    <div class="summary-label">未回答</div>
                </div>
                <div class="summary-item total">
                    <div class="summary-number">${totalCount}</div>
                    <div class="summary-label">合計</div>
                </div>
            </div>
            <div class="members-container">
                <div class="members-grid">
                    ${memberFragments.join('')}
                    <div class="add-member-card">
                        <button class="btn-add-member-card" data-action="add-member">
                            ➕ メンバー追加
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
    }
    
    setupMobileSwipe() {
        const mobileContainer = document.getElementById('mobileContainer');
        const wrapper = document.getElementById('mobileCardsWrapper');
        
        let startX = 0;
        let startY = 0;
        let currentX = 0;
        let isDragging = false;

        // Touch events for mobile
        mobileContainer.addEventListener('touchstart', (e) => {
            // Don't initiate swipe if touching a button or inside members container
            if (e.target.closest('button') || e.target.closest('.members-container')) {
                return;
            }
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isDragging = true;
            wrapper.style.transition = 'none';
        }, { passive: true });

        mobileContainer.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            
            // Only prevent default for horizontal swipe gestures
            const touch = e.touches[0];
            const diffX = Math.abs(touch.clientX - startX);
            const diffY = Math.abs(touch.clientY - startY);
            
            // If horizontal movement is dominant, handle swipe
            if (diffX > diffY) {
                e.preventDefault();
                currentX = touch.clientX;
                const diff = currentX - startX;
                const currentTransform = -(this.currentMobileIndex * 20);
                wrapper.style.transform = `translateX(${currentTransform + (diff / window.innerWidth) * 20}%)`;
            } else {
                // Allow vertical scrolling
                isDragging = false;
                wrapper.style.transition = 'transform 0.3s ease';
                wrapper.style.transform = `translateX(-${this.currentMobileIndex * 20}%)`;
            }
        }, { passive: false });

        mobileContainer.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            wrapper.style.transition = 'transform 0.3s ease';
            
            const diff = currentX - startX;
            const threshold = window.innerWidth * 0.2; // 20% of screen width

            if (Math.abs(diff) > threshold) {
                if (diff > 0 && this.currentMobileIndex > 0) {
                    // Swipe right - go to previous day
                    this.currentMobileIndex--;
                } else if (diff < 0 && this.currentMobileIndex < 4) {
                    // Swipe left - go to next day
                    this.currentMobileIndex++;
                }
            }

            // Update position and indicators
            this.updateMobilePosition();
        });

        // Mouse events for desktop testing
        mobileContainer.addEventListener('mousedown', (e) => {
            // Don't initiate swipe if clicking a button
            if (e.target.closest('button')) {
                return;
            }
            startX = e.clientX;
            isDragging = true;
            wrapper.style.transition = 'none';
            e.preventDefault();
        });

        mobileContainer.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            currentX = e.clientX;
            const diff = currentX - startX;
            const currentTransform = -(this.currentMobileIndex * 20);
            wrapper.style.transform = `translateX(${currentTransform + (diff / window.innerWidth) * 20}%)`;
        });

        mobileContainer.addEventListener('mouseup', (e) => {
            if (!isDragging) return;
            isDragging = false;
            wrapper.style.transition = 'transform 0.3s ease';
            
            const diff = currentX - startX;
            const threshold = window.innerWidth * 0.2;

            if (Math.abs(diff) > threshold) {
                if (diff > 0 && this.currentMobileIndex > 0) {
                    this.currentMobileIndex--;
                } else if (diff < 0 && this.currentMobileIndex < 4) {
                    this.currentMobileIndex++;
                }
            }

            this.updateMobilePosition();
        });

        // Ensure smooth scrolling in members containers
        const membersContainers = document.querySelectorAll('.mobile-card .members-container');
        membersContainers.forEach(container => {
            container.addEventListener('touchstart', (e) => {
                e.stopPropagation(); // Prevent parent swipe handling
            }, { passive: true });
            
            container.addEventListener('touchmove', (e) => {
                e.stopPropagation(); // Prevent parent swipe handling
            }, { passive: true });
        });
    }

    updateMobilePosition() {
        const wrapper = document.getElementById('mobileCardsWrapper');
        const indicators = document.querySelectorAll('.swipe-dot');
        
        wrapper.style.transform = `translateX(-${this.currentMobileIndex * 20}%)`;
        
        indicators.forEach((dot, index) => {
            dot.classList.toggle('active', index === this.currentMobileIndex);
        });
    }

    handleMobileCardClick(event) {
        // Use the same logic as desktop
        this.handleCardClick(event);
    }

    handleCardClick(event) {
        const button = event.target.closest('button');
        if (!button) return;
        
        const action = button.dataset.action;
        if (!action) return;
        
        event.preventDefault();
        
        // Use requestIdleCallback to defer heavy operations
        const processAction = () => {
            switch (action) {
                case 'attend':
                case 'absent':
                    this.updateDayAttendance(
                        button.dataset.day,
                        parseInt(button.dataset.memberId),
                        action
                    );
                    break;
                case 'delete':
                    this.deleteMember(
                        parseInt(button.dataset.memberId),
                        button.dataset.memberName
                    );
                    break;
                case 'pin-current':
                    this.pinCurrentSelection(
                        button.dataset.day,
                        parseInt(button.dataset.memberId)
                    );
                    break;
                case 'add-member':
                    this.showAddMemberDialog();
                    break;
            }
        };

        if (window.requestIdleCallback) {
            window.requestIdleCallback(processAction, { timeout: 50 });
        } else {
            setTimeout(processAction, 0);
        }
    }

    async updateDayAttendance(dayName, memberId, status) {
        try {
            
            // ユーザが明示的に選択した状態と同じならトグルしてnullにする
            const currentMember = this.data.weekData[dayName].members.find(m => m.id === memberId);
            const newStatus = currentMember.originalStatus === status ? null : status;
            
            
            const response = await fetch('/api/attendance/weekly', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ dayName, memberId, status: newStatus }),
            });
            
            if (!response.ok) {
                throw new Error('Failed to update attendance');
            }
            
            // データはWebSocket経由で更新される
        } catch (error) {
            console.error('Failed to update weekly attendance:', error);
            alert('更新に失敗しました。もう一度お試しください。');
        }
    }

    async pinCurrentSelection(dayName, memberId) {
        try {
            
            // Find current member data
            const currentMember = this.data.weekData[dayName].members.find(m => m.id === memberId);
            
            // If already matched (pin-matched-*), do nothing
            if (currentMember.defaultStatus === currentMember.originalStatus) {
                return;
            }
            
            // Set user's explicit selection as default (can be 'attend', 'absent', or 'pending' for null)
            const newDefaultStatus = currentMember.originalStatus === null ? "pending" : currentMember.originalStatus;
            
            const response = await fetch('/api/member-defaults', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    memberId: memberId, 
                    dayName: dayName, 
                    status: newDefaultStatus 
                }),
            });
            
            if (!response.ok) {
                throw new Error('Failed to update member default');
            }
            
            // データはWebSocket経由で更新される
        } catch (error) {
            console.error('Failed to update member default:', error);
            alert('デフォルト設定の更新に失敗しました。もう一度お試しください。');
        }
    }
}

// アプリケーションを開始
const app = new AttendanceApp();