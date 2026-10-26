const ROWS = 10;
const COLUMNS = 5;
const PIPES_BY_MODE = { standard: 12, challenge: 8 };
const POINTS_PER_CLOSER_MOVE = 10;
const POINTS_PER_OBSTACLE_HIT = 10;
const WATER_FACTS = [
  'Clean water close to home gives families more time for school, work, and play.',
  'Access to clean water helps communities stay healthy and build a brighter future.',
  'A reliable water source can make everyday life safer and more manageable.'
];

const startScreen = document.getElementById('start-screen');
const gameScreen = document.getElementById('game-screen');
const endScreen = document.getElementById('end-screen');
const gridElement = document.getElementById('game-grid');
const feedbackElement = document.getElementById('feedback');
const moveButtons = [...document.querySelectorAll('[data-move]')];
let game;
let timerInterval;

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function cellIndex(row, column) {
  return row * COLUMNS + column;
}

function createGame(mode) {
  const startColumn = Math.floor(Math.random() * COLUMNS);
  const sourceColumns = [randomItem([0, 1]), randomItem([3, 4])];
  const sourceIndices = sourceColumns.map(column => cellIndex(ROWS - 1, column));
  const safeRoute = new Set();

  safeRoute.add(cellIndex(0, startColumn));
  safeRoute.add(cellIndex(1, startColumn));
  const targetColumn = sourceColumns.reduce((nearest, column) =>
    Math.abs(column - startColumn) < Math.abs(nearest - startColumn) ? column : nearest
  );
  const horizontalStep = Math.sign(targetColumn - startColumn);
  for (let column = startColumn; column !== targetColumn; column += horizontalStep) {
    safeRoute.add(cellIndex(1, column + horizontalStep));
  }
  for (let row = 2; row < ROWS; row += 1) {
    safeRoute.add(cellIndex(row, targetColumn));
  }

  const terrain = Array.from({ length: ROWS * COLUMNS }, (_, index) => {
    if (safeRoute.has(index) || sourceIndices.includes(index)) return 'clear';
    const roll = Math.random();
    if (roll < 0.16) return 'rock';
    if (roll < 0.30) return 'dirty';
    return 'clear';
  });
  const startIndex = cellIndex(0, startColumn);
  const path = [startIndex];

  return {
    terrain,
    path,
    visited: new Set([startIndex]),
    startIndex,
    sourceIndices,
    position: { row: 0, column: startColumn },
    heading: { row: 1, column: 0 },
    score: 0,
    pipes: PIPES_BY_MODE[mode],
    maxPipes: PIPES_BY_MODE[mode],
    mode,
    elapsedSeconds: 0,
    lastMove: null,
    active: true
  };
}

function visibleCells() {
  const { row, column } = game.position;
  const visible = new Set(game.visited);

  for (let rowOffset = 1; rowOffset <= 2; rowOffset += 1) {
    const visibleRow = row - rowOffset;
    if (visibleRow >= 0 && visibleRow < ROWS) {
      for (let visibleColumn = 0; visibleColumn < COLUMNS; visibleColumn += 1) {
        visible.add(cellIndex(visibleRow, visibleColumn));
      }
    }
  }

  return visible;
}

function shortestSourceDistance(startRow, startColumn) {
  const queue = [{ row: startRow, column: startColumn, distance: 0 }];
  const visited = new Set([cellIndex(startRow, startColumn)]);

  while (queue.length) {
    const current = queue.shift();
    const currentIndex = cellIndex(current.row, current.column);
    if (game.sourceIndices.includes(currentIndex)) return current.distance;

    for (const [rowOffset, columnOffset] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const row = current.row + rowOffset;
      const column = current.column + columnOffset;
      if (row < 0 || row >= ROWS || column < 0 || column >= COLUMNS) continue;
      const index = cellIndex(row, column);
      if (visited.has(index) || game.terrain[index] === 'rock' || game.terrain[index] === 'dirty') continue;
      visited.add(index);
      queue.push({ row, column, distance: current.distance + 1 });
    }
  }

  return Infinity;
}

function directionFor(move) {
  const { row, column } = game.heading;
  if (move === 'left') return { row: column, column: -row };
  if (move === 'right') return { row: -column, column: row };
  if (move === 'horizontal') {
    const nearestSource = game.sourceIndices
      .map(index => index % COLUMNS)
      .sort((first, second) => Math.abs(first - game.position.column) - Math.abs(second - game.position.column))[0];
    const columnDirection = Math.sign(nearestSource - game.position.column);
    return columnDirection ? { row: 0, column: columnDirection } : game.heading;
  }
  return game.heading;
}

function pipeSegmentClass(index, path) {
  const pathPosition = path.indexOf(index);
  const row = Math.floor(index / COLUMNS);
  const column = index % COLUMNS;
  const connections = [];

  if (pathPosition > 0) {
    const previous = path[pathPosition - 1];
    connections.push({ row: Math.floor(previous / COLUMNS) - row, column: previous % COLUMNS - column });
  }
  if (pathPosition < path.length - 1) {
    const next = path[pathPosition + 1];
    connections.push({ row: Math.floor(next / COLUMNS) - row, column: next % COLUMNS - column });
  } else {
    connections.push(game.heading);
  }

  if (connections.every(direction => direction.row === 0)) return 'pipe-segment-horizontal';
  if (connections.every(direction => direction.column === 0)) return 'pipe-segment-vertical';
  const hasUp = connections.some(direction => direction.row === -1);
  const hasDown = connections.some(direction => direction.row === 1);
  const hasLeft = connections.some(direction => direction.column === -1);
  const hasRight = connections.some(direction => direction.column === 1);
  if (hasDown && hasRight) return 'pipe-segment-down-right';
  if (hasDown && hasLeft) return 'pipe-segment-down-left';
  if (hasUp && hasRight) return 'pipe-segment-up-right';
  if (hasUp && hasLeft) return 'pipe-segment-up-left';
  return 'pipe-segment-vertical';
}

function renderBoard() {
  gridElement.innerHTML = '';
  const currentIndex = cellIndex(game.position.row, game.position.column);
  const pathSet = new Set(game.path);
  const visible = visibleCells();

  for (let index = 0; index < ROWS * COLUMNS; index += 1) {
    const row = Math.floor(index / COLUMNS);
    const column = index % COLUMNS;
    const cell = document.createElement('div');
    const onPath = pathSet.has(index);
    const isVisible = visible.has(index);
    let label = isVisible ? 'Clear space' : 'Hidden space';
    let mark = '';
    let stateClass = isVisible ? 'revealed' : 'hidden';

    if (isVisible) {
      if (index === game.startIndex) {
        label = 'Starting pipe, route origin';
        stateClass += ` path-cell ${pipeSegmentClass(index, game.path)}`;
        if (index === currentIndex) {
          label = 'Starting pipe, current pipe position';
          stateClass += ' current-cell';
        }
      } else if (game.sourceIndices.includes(index)) {
        label = 'Clean water source';
        mark = 'W';
        stateClass += ' clean-cell';
      } else if (onPath) {
        label = 'Placed pipe';
        stateClass += ` path-cell ${pipeSegmentClass(index, game.path)}`;
        if (index === currentIndex) {
          label = 'Current pipe position';
          stateClass += ' current-cell';
        }
      } else {
        const terrain = game.terrain[index];
        if (terrain === 'rock') {
          label = 'Rock, blocked';
          mark = 'R';
          stateClass += ' rock-cell';
        } else if (terrain === 'dirty') {
          label = 'Dirty water, avoid';
          mark = 'D';
          stateClass += ' dirty-cell';
        } else {
          label = 'Clear space';
          stateClass += ' clear-cell';
        }
      }
    }

    cell.className = `grid-cell ${stateClass}`;
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-label', `${label}, row ${row + 1}, column ${column + 1}`);
    cell.textContent = mark;
    gridElement.appendChild(cell);
  }

  document.getElementById('score').textContent = game.score;
  document.getElementById('pipes-left').textContent = game.pipes;
  document.getElementById('pipes-left').classList.toggle('low-pipes', game.pipes < game.maxPipes / 3);
  document.getElementById('timer').textContent = game.elapsedSeconds;
  document.getElementById('undo').disabled = !game.lastMove || !game.active;
  moveButtons.forEach(button => { button.disabled = !game.active || game.pipes === 0; });
}

function setFeedback(message, type = '') {
  feedbackElement.textContent = message;
  feedbackElement.className = `feedback${type ? ` feedback-${type}` : ''}`;
}

function placePipe(move) {
  if (!game?.active || game.pipes <= 0) return;
  const direction = directionFor(move);
  const nextRow = game.position.row + direction.row;
  const nextColumn = game.position.column + direction.column;
  if (nextRow < 0 || nextRow >= ROWS || nextColumn < 0 || nextColumn >= COLUMNS) {
    setFeedback('That move reaches the edge. Choose another pipe direction.', 'warning');
    return;
  }

  const nextIndex = cellIndex(nextRow, nextColumn);
  if (game.path.includes(nextIndex)) {
    setFeedback('Your pipe cannot loop back over its own path.', 'warning');
    return;
  }
  if (game.terrain[nextIndex] === 'rock') {
    const pointsLost = Math.min(game.score, POINTS_PER_OBSTACLE_HIT);
    game.score -= pointsLost;
    setFeedback(
      pointsLost
        ? `Rock ahead. No pipe was used, but you lost ${pointsLost} points.`
        : 'Rock ahead. No pipe was used. Your score cannot drop below zero.',
      'warning'
    );
    renderBoard();
    return;
  }

  const oldDistance = shortestSourceDistance(game.position.row, game.position.column);
  game.lastMove = {
    position: { ...game.position },
    heading: { ...game.heading },
    score: game.score,
    pipes: game.pipes
  };
  game.position = { row: nextRow, column: nextColumn };
  game.heading = direction;
  game.path.push(nextIndex);
  game.visited.add(nextIndex);
  game.pipes -= 1;

  if (game.terrain[nextIndex] === 'dirty') {
    renderBoard();
    finishGame(false);
    return;
  }
  if (game.sourceIndices.includes(nextIndex)) {
    const newDistance = shortestSourceDistance(nextRow, nextColumn);
    if (newDistance < oldDistance) game.score += POINTS_PER_CLOSER_MOVE;
    renderBoard();
    finishGame(true);
    return;
  }

  const newDistance = shortestSourceDistance(nextRow, nextColumn);
  if (newDistance < oldDistance) {
    game.score += POINTS_PER_CLOSER_MOVE;
    setFeedback(`Good move. You are closer to clean water: +${POINTS_PER_CLOSER_MOVE} points.`, 'good');
  } else {
    setFeedback('Pipe placed. Your score stays the same because this move did not get closer.');
  }
  renderBoard();
  if (game.pipes === 0) finishGame(false);
}

function undoMove() {
  if (!game?.active || !game.lastMove) return;
  const previous = game.lastMove;
  game.lastMove = null;
  game.path.pop();
  game.position = previous.position;
  game.heading = previous.heading;
  game.score = previous.score;
  game.pipes = previous.pipes;
  setFeedback('Last pipe removed. Your pipe and score counts are restored.');
  renderBoard();
}

function finishGame(won) {
  game.active = false;
  clearInterval(timerInterval);
  if (won) showConfetti();
  else clearConfetti();
  document.getElementById('result-title').textContent = won ? 'Congratulations!' : 'Try again!';
  document.getElementById('result-mark').textContent = won ? '✓' : '↻';
  document.getElementById('result-mark').classList.toggle('result-mark-loss', !won);
  document.getElementById('result-message').textContent = won
    ? 'You have brought clean water to the village!'
    : 'Try again to supply the village with clean water.';
  document.getElementById('final-score').textContent = game.score;
  document.getElementById('water-fact').textContent = randomItem(WATER_FACTS);
  gameScreen.hidden = true;
  endScreen.hidden = false;
}

function clearConfetti() {
  const confettiElement = document.getElementById('confetti');
  confettiElement.innerHTML = '';
  confettiElement.hidden = true;
}

function showConfetti() {
  const confettiElement = document.getElementById('confetti');
  const colors = ['#ffc907', '#2e9df7', '#168058', '#f2bd00', '#e8f5ff'];
  confettiElement.innerHTML = '';
  confettiElement.hidden = false;

  for (let index = 0; index < 36; index += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * 0.8}s`;
    piece.style.backgroundColor = randomItem(colors);
    confettiElement.appendChild(piece);
  }
}

function selectedMode() {
  return document.querySelector('[name="game-mode"]:checked').value;
}

function updateModeNote() {
  const mode = selectedMode();
  document.getElementById('start-note').textContent =
    `10 rows · 5 columns · ${PIPES_BY_MODE[mode]} pipes`;
}

function startGame(mode = selectedMode()) {
  clearInterval(timerInterval);
  clearConfetti();
  game = createGame(mode);
  startScreen.hidden = true;
  endScreen.hidden = true;
  gameScreen.hidden = false;
  setFeedback('Choose a direction to extend the starting pipe.');
  renderBoard();
  timerInterval = setInterval(() => {
    if (!game.active) return;
    game.elapsedSeconds += 1;
    document.getElementById('timer').textContent = game.elapsedSeconds;
  }, 1000);
}

document.getElementById('start-game').addEventListener('click', startGame);
document.getElementById('play-again').addEventListener('click', () => startGame(game.mode));
document.getElementById('reset-game').addEventListener('click', () => {
  if (window.confirm('Restart this game? Your current route and score will be lost.')) {
    startGame(game.mode);
  }
});
document.querySelectorAll('[name="game-mode"]').forEach(input => {
  input.addEventListener('change', updateModeNote);
});
document.getElementById('undo').addEventListener('click', undoMove);
document.getElementById('quit-game').addEventListener('click', () => {
  clearInterval(timerInterval);
  game.active = false;
  gameScreen.hidden = true;
  startScreen.hidden = false;
});
moveButtons.forEach(button => button.addEventListener('click', () => placePipe(button.dataset.move)));
