class AttendanceApp {
    constructor() {
        this.ws = null;
        this.data = null;
        this.init();
    }

    init() {
        this.setupWebSocket();
        this.loadData();
        this.updateDate();
        this.startCountdown();
    }

    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
        };
        
        this.ws.onmessage = (event) => {
            console.log('WebSocket message received:', event.data);
            const message = JSON.parse(event.data);
            console.log('Parsed message:', message);
            if (message.type === 'attendance_update') {
                console.log('Updating UI with new data:', message.data);
                this.data = message.data;
                this.render();
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

    async loadData() {
        try {
            const response = await fetch('/api/attendance/today');
            this.data = await response.json();
            this.render();
        } catch (error) {
            console.error('Failed to load data:', error);
            document.getElementById('membersList').innerHTML = 
                '<div style="color: #dc3545;">データの読み込みに失敗しました</div>';
        }
    }

    updateDate() {
        const today = new Date();
        const options = { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric', 
            weekday: 'long' 
        };
        document.getElementById('currentDate').textContent = 
            today.toLocaleDateString('ja-JP', options);
    }

    async updateAttendance(memberId, status) {
        try {
            const response = await fetch('/api/attendance', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ memberId, status }),
            });
            
            if (!response.ok) {
                throw new Error('Failed to update attendance');
            }
            
            // データは WebSocket 経由で更新される
        } catch (error) {
            console.error('Failed to update attendance:', error);
            alert('更新に失敗しました。もう一度お試しください。');
        }
    }

    render() {
        if (!this.data) return;

        // 合計値を更新
        document.getElementById('attendCount').textContent = this.data.summary.attend;
        document.getElementById('absentCount').textContent = this.data.summary.absent;
        document.getElementById('pendingCount').textContent = this.data.summary.pending;
        document.getElementById('totalCount').textContent = this.data.summary.total;

        // メンバーカードを生成
        const membersList = document.getElementById('membersList');
        membersList.innerHTML = this.data.members.map(member => {
            const cardClass = member.status ? 
                (member.status === 'attend' ? 'attending' : 'absent') : '';
            
            return `
                <div class="member-card ${cardClass}">
                    <div class="member-info">
                        <span class="status-indicator ${
                            member.status ? 
                            (member.status === 'attend' ? 'status-attend' : 'status-absent') : 
                            'status-pending'
                        }"></span>
                        <span class="member-name">${member.name}</span>
                    </div>
                    <div class="member-buttons">
                        <button 
                            class="btn btn-attend ${member.status === 'attend' ? 'active' : ''}"
                            onclick="app.updateAttendance(${member.id}, 'attend')"
                        >
                            ✓ 参加
                        </button>
                        <button 
                            class="btn btn-absent ${member.status === 'absent' ? 'active' : ''}"
                            onclick="app.updateAttendance(${member.id}, 'absent')"
                        >
                            ✗ 欠席
                        </button>
                        <button 
                            class="btn-delete"
                            onclick="app.deleteMember(${member.id}, '${member.name}')"
                            title="メンバーを削除"
                        >
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }).join('');
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
            
            // Restart countdown timer
            clearInterval(this.countdownInterval);
            this.startCountdown();
            
            // データは WebSocket 経由で更新される
        } catch (error) {
            console.error('Failed to reset attendance:', error);
            alert('リセットに失敗しました。もう一度お試しください。');
        }
    }

    async startCountdown() {
        try {
            // Clear existing interval if any
            if (this.countdownInterval) {
                clearInterval(this.countdownInterval);
            }
            
            const response = await fetch('/api/next-reset');
            const { nextReset, timeUntilReset } = await response.json();
            
            this.nextResetTime = new Date(nextReset);
            this.updateCountdown();
            
            // Update countdown every second
            this.countdownInterval = setInterval(() => {
                this.updateCountdown();
            }, 1000);
        } catch (error) {
            console.error('Failed to get next reset time:', error);
            document.getElementById('countdownTime').textContent = 'エラー';
        }
    }

    updateCountdown() {
        const now = new Date();
        const timeLeft = this.nextResetTime.getTime() - now.getTime();
        
        if (timeLeft <= 0) {
            // Reset has occurred, reload data and restart countdown
            this.loadData();
            this.startCountdown();
            return;
        }
        
        const hours = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
        
        const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        document.getElementById('countdownTime').textContent = timeString;
        
        // Change color when close to reset time
        const countdownElement = document.getElementById('countdownTimer');
        if (timeLeft < 5 * 60 * 1000) { // Last 5 minutes
            countdownElement.style.background = 'rgba(220, 53, 69, 0.3)';
        } else if (timeLeft < 30 * 60 * 1000) { // Last 30 minutes
            countdownElement.style.background = 'rgba(255, 193, 7, 0.3)';
        } else {
            countdownElement.style.background = 'rgba(255, 255, 255, 0.2)';
        }
    }
}

// アプリケーションを開始
const app = new AttendanceApp();