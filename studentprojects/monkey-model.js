/*
 * SCUDEM: two monkeys, local tree attraction, Goldilocks spacing, and sharing.
 * JavaScript port of MonkeyModelCommunication.m, for a static web page.
 *
 * Empty-tree information removes attraction; food reports cause direct travel.
 * Loss means a missed fact, never a false fact. Missed facts are retried.
 *
 * Usage: include this file at the end of index.html (see the accompanying page).
 * The model core (no DOM) is also exposed as window.MonkeyModel, and as
 * module.exports under Node, for scripted batch runs.
 *
 * Note: JavaScript has no MATLAB 'twister' generator, so this port uses its own
 * seeded generator (mulberry32). A seed replays the same trial in this page, but
 * it will not reproduce the same trial as the same seed in MATLAB.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Adjustable settings (defaults match the MATLAB script)
  // [group, key, label, default, help]
  // ---------------------------------------------------------------------------
  const PARAMS = [
    ['Forest and movement', 'forestWidth', 'Forest width', 200],
    ['Forest and movement', 'forestHeight', 'Forest height', 200],
    ['Forest and movement', 'numberTrees', 'Number of trees', 200],
    ['Forest and movement', 'fruitFraction', 'Fruit fraction', 0.06],
    ['Forest and movement', 'maxSpeed', 'Max speed', 2],
    ['Forest and movement', 'lengthAttract', 'Attraction length L', 4, 'L in the tree-attraction equation.'],
    ['Forest and movement', 'treeAttractionRadius', 'Tree attraction radius', 30],
    ['Forest and movement', 'arrivalRadius', 'Arrival radius', 0.5],
    ['Forest and movement', 'checkTime', 'Check time', 5],
    ['Forest and movement', 'eatTime', 'Eat time', 2],
    ['Forest and movement', 'dt', 'Time step dt', 0.1, 'Need dt <= arrivalRadius / maxSpeed.'],
    ['Forest and movement', 'maxTime', 'Max time', 1000],

    ['Trial', 'useFixedSeed', 'Use fixed seed', false, 'Off = a new random trial on every run.'],
    ['Trial', 'randomSeed', 'Seed', 1, 'Used only when "Use fixed seed" is on. Filled in after each random trial.'],

    ['Goldilocks zone', 'communicationRange', 'Communication range R', 60, 'Facts are shared only within this distance.'],
    ['Goldilocks zone', 'goldilocksInnerFraction', 'Inner fraction', 0.80],
    ['Goldilocks zone', 'goldilocksOuterFraction', 'Outer fraction', 0.95],
    ['Goldilocks zone', 'socialMaxSpeed', 'Social max speed A', 2, 'Maximum social contribution to velocity.'],
    ['Goldilocks zone', 'socialLength', 'Social length L_s', 5, 'Error at which social strength is A/2.'],
    ['Goldilocks zone', 'maxSpawnAttempts', 'Max spawn attempts', 10000],

    ['Information loss', 'communicationInterval', 'Retry interval', 1, 'In simulated time, not frames.'],
    ['Information loss', 'communicationMinSuccess', 'Receipt chance at d = R', 0.80],
    ['Information loss', 'communicationFalloffPower', 'Falloff power', 2, 'Larger = reliability stays high until near R.'],

    ['Roaming when stuck', 'stuckDistance', 'Stuck distance', 0.5],
    ['Roaming when stuck', 'stuckWaitTime', 'Stuck wait time', 5],
    ['Roaming when stuck', 'roamSpeedFraction', 'Roam speed (x max speed)', 0.5],
    ['Roaming when stuck', 'roamDuration', 'Roam duration', 5],

    ['Display', 'showAnimation', 'Show animation', true, 'Off = compute the trial without animation.'],
    ['Display', 'plotEvery', 'Steps per frame', 5, 'Simulation steps per animation frame (can change while running).'],
    ['Display', 'runSelfChecks', 'Run self-checks', true, "Quick assertions for the model's helper rules."]
  ].map(([group, key, label, value, help]) => ({ group, key, label, value, help: help || '' }));

  const NUMBER_MONKEYS = 2;
  const EPS = 1e-9;

  function defaultParams() {
    const p = {};
    for (const d of PARAMS) p[d.key] = d.value;
    return p;
  }

  function req(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  // ---------------------------------------------------------------------------
  // Validate settings
  // ---------------------------------------------------------------------------
  function validateParams(p) {
    const isInt = (x) => Number.isFinite(x) && x === Math.floor(x);
    req(isInt(p.numberTrees) && p.numberTrees >= 1, 'Number of trees must be a positive integer.');
    req(p.fruitFraction > 0 && p.fruitFraction <= 1, 'Fruit fraction must be in (0, 1].');
    const positives = ['forestWidth', 'forestHeight', 'maxSpeed', 'lengthAttract',
      'treeAttractionRadius', 'arrivalRadius', 'checkTime', 'eatTime', 'dt', 'maxTime',
      'communicationRange', 'socialLength', 'communicationInterval',
      'stuckDistance', 'stuckWaitTime', 'roamSpeedFraction', 'roamDuration'];
    for (const k of positives) {
      req(Number.isFinite(p[k]) && p[k] > 0, `${labelOf(k)} must be a finite positive number.`);
    }
    req(Number.isFinite(p.socialMaxSpeed) && p.socialMaxSpeed >= 0, 'Social max speed must be >= 0.');
    req(0 < p.goldilocksInnerFraction && p.goldilocksInnerFraction < p.goldilocksOuterFraction
      && p.goldilocksOuterFraction < 1, 'Need 0 < inner fraction < outer fraction < 1.');
    req(p.communicationMinSuccess >= 0 && p.communicationMinSuccess <= 1,
      'Receipt chance at d = R must be in [0, 1].');
    req(Number.isFinite(p.communicationFalloffPower) && p.communicationFalloffPower > 0,
      'Falloff power must be a finite positive number.');
    req(p.goldilocksInnerFraction * p.communicationRange < Math.hypot(p.forestWidth, p.forestHeight),
      'The preferred starting separation must fit inside the forest.');
    req(p.maxSpeed * p.dt <= p.arrivalRadius,
      'Use dt <= arrivalRadius/maxSpeed to resolve tree encounters.');
    req(isInt(p.plotEvery) && p.plotEvery >= 1, 'Steps per frame must be a positive integer.');
    req(isInt(p.maxSpawnAttempts) && p.maxSpawnAttempts >= 1, 'Max spawn attempts must be a positive integer.');
    if (p.useFixedSeed) req(isInt(p.randomSeed), 'Seed must be an integer.');
  }

  function labelOf(key) {
    const d = PARAMS.find((x) => x.key === key);
    return d ? d.label : key;
  }

  // ---------------------------------------------------------------------------
  // Seeded random numbers
  // ---------------------------------------------------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newRandomSeed() {
    return 1 + Math.floor(Math.random() * (2 ** 31 - 3));
  }

  // ---------------------------------------------------------------------------
  // Helper functions (direct ports of the MATLAB helpers)
  // Monkeys are indexed 0 and 1 here (MATLAB uses 1 and 2).
  // ---------------------------------------------------------------------------
  function separatedStarts(width, height, minimum, maximum, attempts, rand) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const x1 = width * rand(), x2 = width * rand();
      const y1 = height * rand(), y2 = height * rand();
      const d = Math.hypot(x1 - x2, y1 - y2);
      if (d >= minimum && d <= maximum) return [[x1, y1], [x2, y2]];
    }
    throw new Error('Could not sample starts in the preferred band. Check range/forest size.');
  }

  // >>> GOLDILOCKS EQUATION: TUNE/REPLACE THIS HELPER LATER <<<
  // One signed function: negative error repels; positive attracts.
  function goldilocksPull(positions, m, R, inner, outer, A, Ls) {
    const tx = positions[1 - m][0] - positions[m][0];
    const ty = positions[1 - m][1] - positions[m][1];
    const d = Math.hypot(tx, ty);
    let ux, uy;
    if (d > 0) {
      ux = tx / d; uy = ty / d;
    } else {
      ux = m === 0 ? 1 : -1; uy = 0; // Opposite escape directions at overlap.
    }
    let signedError;
    if (d < inner * R) signedError = d - inner * R;       // Negative: repel.
    else if (d > outer * R) signedError = d - outer * R;  // Positive: attract.
    else signedError = 0;
    // >>> REPLACE/TUNE THIS SIGNED SOCIAL FUNCTION HERE <<<
    const signedSpeed = A * signedError / (Ls + Math.abs(signedError));
    return [signedSpeed * ux, signedSpeed * uy];
  }

  function limitSpeed(vx, vy, maximum) {
    const speed = Math.hypot(vx, vy);
    if (speed > maximum) return [maximum * vx / speed, maximum * vy / speed];
    return [vx, vy];
  }

  // Within range: p(d) = 1 - (1 - edgeSuccess)*(d/R)^power. Outside range: 0.
  function informationProbability(d, R, edgeSuccess, power) {
    if (d > R) return 0;
    // >>> TUNE DISTANCE FALLOFF WITH edgeSuccess AND power <<<
    const p = 1 - (1 - edgeSuccess) * Math.pow(d / R, power);
    return Math.min(1, Math.max(0, p));
  }

  // knowledge: [Int8Array, Int8Array], one per monkey; entries -1 unknown,
  // 0 known empty, 1 known food. Updated in place and also returned.
  // Each previously unknown tree fact is sampled separately.
  function exchangeFacts(knowledge, separation, R, edgeSuccess, power, rand) {
    const attempted = [0, 0], received = [0, 0], foodReceived = [0, 0];
    const p = informationProbability(separation, R, edgeSuccess, power);
    if (separation > R) return { knowledge, attempted, received, foodReceived, p };
    const snapshot = knowledge.map((k) => k.slice()); // Both send from pre-exchange knowledge.
    for (let sender = 0; sender < 2; sender++) {
      const receiver = 1 - sender;
      const s = snapshot[sender], r = snapshot[receiver];
      for (let j = 0; j < s.length; j++) {
        if (s[j] >= 0 && r[j] === -1) {
          attempted[receiver]++;
          if (rand() < p) {
            knowledge[receiver][j] = s[j];
            received[receiver]++;
            if (s[j] === 1) foodReceived[receiver]++;
          }
        }
      }
    }
    return { knowledge, attempted, received, foodReceived, p };
  }

  // Known-answer tests of the actual helpers (no forest truth is transmitted).
  function checkModelRules() {
    const close = (a, b) => Math.abs(a - b) < 1e-12;
    req(close(informationProbability(0, 60, 0.8, 2), 1), 'self-check: p(0)');
    req(close(informationProbability(30, 60, 0.8, 2), 0.95), 'self-check: p(R/2)');
    req(close(informationProbability(60, 60, 0.8, 2), 0.8), 'self-check: p(R)');
    req(informationProbability(61, 60, 0.8, 2) === 0, 'self-check: p beyond R');
    const near = goldilocksPull([[0, 0], [40, 0]], 0, 60, 0.8, 0.95, 2, 5);
    const far = goldilocksPull([[0, 0], [65, 0]], 0, 60, 0.8, 0.95, 2, 5);
    const middle = goldilocksPull([[0, 0], [52, 0]], 0, 60, 0.8, 0.95, 2, 5);
    req(near[0] < 0 && far[0] > 0 && Math.hypot(...middle) === 0, 'self-check: Goldilocks signs');
    const far2 = goldilocksPull([[0, 0], [65, 0]], 1, 60, 0.8, 0.95, 2, 5);
    req(Math.hypot(far2[0] + far[0], far2[1] + far[1]) < 1e-12, 'self-check: Goldilocks symmetry');
    req(goldilocksPull([[0, 0], [0, 0]], 0, 60, 0.8, 0.95, 2, 5).every(Number.isFinite),
      'self-check: Goldilocks at overlap');
    const initial = () => [Int8Array.from([0, 1, -1, -1]), Int8Array.from([-1, -1, 0, -1])];
    const ex = exchangeFacts(initial(), 30, 60, 1, 2, Math.random);
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    req(same(ex.knowledge[0], [0, 1, 0, -1]) && same(ex.knowledge[1], [0, 1, 0, -1]),
      'self-check: exchange result');
    req(same(ex.received, [1, 2]) && same(ex.foodReceived, [0, 1]), 'self-check: exchange counts');
    const out = exchangeFacts(initial(), 61, 60, 1, 2, Math.random).knowledge;
    req(same(out[0], initial()[0]) && same(out[1], initial()[1]), 'self-check: out of range');
    const lost = exchangeFacts(initial(), 60, 60, 0, 2, Math.random).knowledge;
    req(same(lost[0], initial()[0]) && same(lost[1], initial()[1]), 'self-check: zero receipt');
    req(Math.hypot(...limitSpeed(3, 4, 2)) <= 2 + 1e-12, 'self-check: speed limit');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Build a trial
  // ---------------------------------------------------------------------------
  function createSimulation(params, seed) {
    const p = Object.assign({}, params);
    validateParams(p);
    const rand = mulberry32(seed);
    const N = p.numberTrees;
    const R = p.communicationRange;

    const treeX = new Float64Array(N), treeY = new Float64Array(N);
    for (let j = 0; j < N; j++) treeX[j] = p.forestWidth * rand();
    for (let j = 0; j < N; j++) treeY[j] = p.forestHeight * rand();

    // randperm(N, k) via a partial Fisher-Yates shuffle.
    const numberFruitTrees = Math.ceil(p.fruitFraction * N);
    const order = Array.from({ length: N }, (_, i) => i);
    for (let i = 0; i < numberFruitTrees; i++) {
      const k = i + Math.floor(rand() * (N - i));
      [order[i], order[k]] = [order[k], order[i]];
    }
    const treeHasFood = new Uint8Array(N);
    for (let i = 0; i < numberFruitTrees; i++) treeHasFood[order[i]] = 1;

    // Start spread apart but already inside the preferred communication zone.
    const monkeys = separatedStarts(p.forestWidth, p.forestHeight,
      p.goldilocksInnerFraction * R, p.goldilocksOuterFraction * R, p.maxSpawnAttempts, rand);
    const spawnSeparation = Math.hypot(monkeys[0][0] - monkeys[1][0], monkeys[0][1] - monkeys[1][1]);

    const pair = (f) => [f(), f()];
    return {
      p, seed, rand,
      roamSpeed: p.roamSpeedFraction * p.maxSpeed,
      treeX, treeY, treeHasFood, numberFruitTrees,
      monkeys,
      initialPositions: monkeys.map((m) => m.slice()),
      spawnSeparation,
      // Each monkey has separate knowledge: -1 unknown, 0 known empty, 1 known food.
      // Shared facts never reveal the forest's hidden truth directly.
      treeKnowledge: pair(() => new Int8Array(N).fill(-1)),
      personallyChecked: pair(() => new Uint8Array(N)),
      state: ['search', 'search'],
      stateTime: [0, 0],
      currentTree: [-1, -1],
      foodTarget: [-1, -1],
      hasEaten: [false, false],
      completionTime: [NaN, NaN],
      distanceTraveled: [0, 0],
      treesChecked: [0, 0],
      stuckTime: [0, 0],
      stuckAnchor: monkeys.map((m) => m.slice()),
      roamTimeLeft: [0, 0],
      roamDirection: [[0, 0], [0, 0]],
      roamEpisodes: [0, 0],
      factsAttempted: [0, 0],
      factsReceived: [0, 0],
      foodReportsReceived: [0, 0],
      elapsedTime: 0,
      nextCommunicationTime: p.communicationInterval,
      communicationAttempts: 0,
      timeInContact: 0,
      maxSeparation: spawnSeparation,
      partnerDistance: spawnSeparation,
      // Communication columns: time, separation, receipt probability, attempts, received.
      communicationLog: [],
      // History columns: time, separation, x1, y1, x2, y2.
      history: [[0, spawnSeparation, monkeys[0][0], monkeys[0][1], monkeys[1][0], monkeys[1][1]]],
      steps: 0,
      finished: false
    };
  }

  // ---------------------------------------------------------------------------
  // Advance one (possibly split) time step. Returns display hints.
  // ---------------------------------------------------------------------------
  function stepSimulation(s) {
    if (s.finished) return { behaviorChanged: false, emptyTreeDiscovered: false };
    const p = s.p;
    const N = p.numberTrees;
    const tx = s.treeX, ty = s.treeY;
    s.steps++;
    let behaviorChanged = false, newFoodFound = false, emptyTreeDiscovered = false;

    // Prepare behavior from knowledge available at this time.
    for (let m = 0; m < 2; m++) {
      if (s.hasEaten[m]) continue;
      const know = s.treeKnowledge[m];
      const [mx, my] = s.monkeys[m];
      if (s.state[m] === 'search') {
        let best = -1, bestD = Infinity;
        for (let j = 0; j < N; j++) {
          if (know[j] === 1) {
            const d = Math.hypot(tx[j] - mx, ty[j] - my);
            if (d < bestD) { bestD = d; best = j; }
          }
        }
        if (best >= 0) {
          // Food reports are the only shared facts that create a target.
          s.foodTarget[m] = best;
          s.state[m] = 'travelFood';
          behaviorChanged = true;
        } else {
          best = -1; bestD = Infinity;
          for (let j = 0; j < N; j++) {
            if (know[j] === -1) {
              const d = Math.hypot(tx[j] - mx, ty[j] - my);
              if (d < bestD) { bestD = d; best = j; }
            }
          }
          if (bestD <= p.arrivalRadius) {
            s.currentTree[m] = best;
            s.state[m] = 'check';
            s.stateTime[m] = 0;
            behaviorChanged = true;
          }
        }
      }
      if (s.state[m] === 'travelFood') {
        const f = s.foodTarget[m];
        if (Math.hypot(tx[f] - mx, ty[f] - my) <= p.arrivalRadius) {
          s.currentTree[m] = f;
          s.state[m] = 'eat'; // Trusted food report: no second inspection.
          s.stateTime[m] = 0;
          behaviorChanged = true;
        }
      }
      if (s.state[m] !== 'search') {
        s.stuckTime[m] = 0;
        s.stuckAnchor[m] = s.monkeys[m].slice();
        s.roamTimeLeft[m] = 0;
      }
    }

    // Split time steps at scheduled communication and activity completions.
    // This makes communication frequency independent of numerical dt.
    let stepDt = Math.min(p.dt, p.maxTime - s.elapsedTime, s.nextCommunicationTime - s.elapsedTime);
    for (let m = 0; m < 2; m++) {
      if (s.state[m] === 'check') stepDt = Math.min(stepDt, p.checkTime - s.stateTime[m]);
      else if (s.state[m] === 'eat') stepDt = Math.min(stepDt, p.eatTime - s.stateTime[m]);
      else if (s.state[m] === 'search' && s.roamTimeLeft[m] > EPS) stepDt = Math.min(stepDt, s.roamTimeLeft[m]);
    }
    req(stepDt > 0, 'Unexpected zero time step.');
    const start = s.monkeys.map((m) => m.slice());
    let partnerDistance = Math.hypot(start[0][0] - start[1][0], start[0][1] - start[1][1]);
    if (partnerDistance <= p.communicationRange) s.timeInContact += stepDt;

    for (let m = 0; m < 2; m++) {
      switch (s.state[m]) {
        case 'search': {
          const know = s.treeKnowledge[m];
          const [px, py] = start[m];
          let vx = 0, vy = 0;
          for (let j = 0; j < N; j++) {
            if (know[j] !== -1) continue;
            const dx = tx[j] - px, dy = ty[j] - py;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d <= p.treeAttractionRadius) {
              const w = p.maxSpeed / (1 + d / p.lengthAttract);
              vx += dx / d * w;
              vy += dy / d * w;
            }
          }

          // >>> GOLDILOCKS EQUATION: TUNE/REPLACE goldilocksPull LATER <<<
          const social = goldilocksPull(start, m, p.communicationRange,
            p.goldilocksInnerFraction, p.goldilocksOuterFraction, p.socialMaxSpeed, p.socialLength);

          const wasRoaming = s.roamTimeLeft[m] > EPS;
          if (wasRoaming) {
            const dir = s.roamDirection[m];
            const cx = s.monkeys[m][0] + s.roamSpeed * dir[0] * stepDt;
            const cy = s.monkeys[m][1] + s.roamSpeed * dir[1] * stepDt;
            if (cx < 0 || cx > p.forestWidth) dir[0] = -dir[0];
            if (cy < 0 || cy > p.forestHeight) dir[1] = -dir[1];
            vx = s.roamSpeed * dir[0];
            vy = s.roamSpeed * dir[1];
          }
          // Social spacing remains active even while escaping a trap.
          [vx, vy] = limitSpeed(vx + social[0], vy + social[1], p.maxSpeed);
          const prev = s.monkeys[m];
          const next = [
            Math.min(Math.max(prev[0] + vx * stepDt, 0), p.forestWidth),
            Math.min(Math.max(prev[1] + vy * stepDt, 0), p.forestHeight)
          ];
          s.monkeys[m] = next;
          s.distanceTraveled[m] += Math.hypot(next[0] - prev[0], next[1] - prev[1]);

          if (wasRoaming) {
            s.roamTimeLeft[m] = Math.max(0, s.roamTimeLeft[m] - stepDt);
            if (s.roamTimeLeft[m] < EPS) s.roamTimeLeft[m] = 0;
            s.stuckTime[m] = 0;
            s.stuckAnchor[m] = next.slice();
          } else if (Math.hypot(next[0] - s.stuckAnchor[m][0], next[1] - s.stuckAnchor[m][1]) >= p.stuckDistance) {
            s.stuckTime[m] = 0;
            s.stuckAnchor[m] = next.slice();
          } else {
            s.stuckTime[m] += stepDt;
            if (s.stuckTime[m] >= p.stuckWaitTime - EPS) {
              const heading = 2 * Math.PI * s.rand();
              s.roamDirection[m] = [Math.cos(heading), Math.sin(heading)];
              s.roamTimeLeft[m] = p.roamDuration;
              s.roamEpisodes[m]++;
              s.stuckTime[m] = 0;
              s.stuckAnchor[m] = next.slice();
              behaviorChanged = true;
            }
          }
          break;
        }

        case 'travelFood': {
          // Override ordinary tree pulls AND social spacing to share food.
          const f = s.foodTarget[m];
          const dx = tx[f] - s.monkeys[m][0], dy = ty[f] - s.monkeys[m][1];
          const d = Math.hypot(dx, dy);
          if (d > 0) {
            const speed = Math.min(p.maxSpeed / (1 + d / p.lengthAttract), d / stepDt);
            const mvx = speed * dx / d * stepDt, mvy = speed * dy / d * stepDt;
            s.monkeys[m] = [s.monkeys[m][0] + mvx, s.monkeys[m][1] + mvy];
            s.distanceTraveled[m] += Math.hypot(mvx, mvy);
          }
          break;
        }

        case 'check': {
          s.stateTime[m] += stepDt;
          if (s.stateTime[m] >= p.checkTime - EPS) {
            const j = s.currentTree[m];
            s.personallyChecked[m][j] = 1;
            s.treesChecked[m]++;
            s.stateTime[m] = 0;
            // The hidden food status is read ONLY after checking.
            if (s.treeHasFood[j]) {
              s.treeKnowledge[m][j] = 1;
              s.foodTarget[m] = j;
              s.state[m] = 'eat';
              newFoodFound = true;
            } else {
              s.treeKnowledge[m][j] = 0;
              s.state[m] = 'search';
              emptyTreeDiscovered = true;
            }
            behaviorChanged = true;
          }
          break;
        }

        case 'eat': {
          s.stateTime[m] += stepDt;
          if (s.stateTime[m] >= p.eatTime - EPS) {
            s.hasEaten[m] = true;
            s.state[m] = 'done';
            s.completionTime[m] = s.elapsedTime + stepDt;
            behaviorChanged = true;
          }
          break;
        }
      }
    }

    s.elapsedTime += stepDt;
    partnerDistance = Math.hypot(s.monkeys[0][0] - s.monkeys[1][0], s.monkeys[0][1] - s.monkeys[1][1]);
    s.partnerDistance = partnerDistance;
    s.maxSeparation = Math.max(s.maxSeparation, partnerDistance);

    // Repeated, bidirectional sharing; no three-tree counter and no report trip.
    // Food discoveries also cause one immediate attempt, then scheduled retries.
    const scheduledAttempt = s.elapsedTime >= s.nextCommunicationTime - EPS;
    if (scheduledAttempt || newFoodFound) {
      const ex = exchangeFacts(s.treeKnowledge, partnerDistance, p.communicationRange,
        p.communicationMinSuccess, p.communicationFalloffPower, s.rand);
      for (let r = 0; r < 2; r++) {
        s.factsAttempted[r] += ex.attempted[r];
        s.factsReceived[r] += ex.received[r];
        s.foodReportsReceived[r] += ex.foodReceived[r];
      }
      if (partnerDistance <= p.communicationRange) s.communicationAttempts++;
      s.communicationLog.push([s.elapsedTime, partnerDistance, ex.p,
        ex.attempted[0] + ex.attempted[1], ex.received[0] + ex.received[1]]);
      behaviorChanged = behaviorChanged || ex.received[0] > 0 || ex.received[1] > 0;
      if (scheduledAttempt) s.nextCommunicationTime += p.communicationInterval;
    }

    s.history.push([s.elapsedTime, partnerDistance,
      s.monkeys[0][0], s.monkeys[0][1], s.monkeys[1][0], s.monkeys[1][1]]);

    if (s.elapsedTime >= p.maxTime - EPS || (s.hasEaten[0] && s.hasEaten[1])) s.finished = true;
    return { behaviorChanged, emptyTreeDiscovered };
  }

  function runToEnd(s) {
    while (!s.finished) stepSimulation(s);
    return s;
  }

  function summarize(s) {
    const sum = (a) => a[0] + a[1];
    const fed = s.hasEaten.filter(Boolean).length;
    const rows = [0, 1].map((m) => ({
      Monkey: m + 1,
      HasEaten: s.hasEaten[m],
      CompletionTime: s.completionTime[m],
      DistanceTraveled: s.distanceTraveled[m],
      TreesChecked: s.treesChecked[m],
      RoamEpisodes: s.roamEpisodes[m],
      FactsReceived: s.factsReceived[m],
      FoodReportsReceived: s.foodReportsReceived[m]
    }));
    const lines = [
      `Trial seed: ${s.seed} (tick "Use fixed seed" and enter it to replay)`,
      `Trial duration: ${s.elapsedTime.toFixed(1)} | monkeys fed: ${fed}/2 (${50 * fed}%)`,
      `Initial separation: ${s.spawnSeparation.toFixed(2)} | maximum separation: ${s.maxSeparation.toFixed(2)}`,
      `Approximate time in contact: ${(100 * s.timeInContact / Math.max(s.elapsedTime, Number.EPSILON)).toFixed(1)}%`,
      `Communication opportunities while in range: ${s.communicationAttempts}`,
      `Facts attempted: ${sum(s.factsAttempted)} | received: ${sum(s.factsReceived)} | missed: ${sum(s.factsAttempted) - sum(s.factsReceived)}`
    ];
    if (s.finished && !(s.hasEaten[0] && s.hasEaten[1])) {
      lines.push('Time limit reached before both monkeys finished eating.');
    }
    return { rows, lines };
  }

  const core = {
    PARAMS, defaultParams, validateParams, mulberry32, newRandomSeed,
    separatedStarts, goldilocksPull, limitSpeed, informationProbability, exchangeFacts,
    checkModelRules, createSimulation, stepSimulation, runToEnd, summarize
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  global.MonkeyModel = core;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI);
    else initUI();
  }

  // ===========================================================================
  // Page UI (canvas animation, controls, results)
  // ===========================================================================
  function initUI() {
    const $ = (id) => document.getElementById(id);
    const canvas = $('mm-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const COLORS = ['rgb(255,0,0)', 'rgb(0,77,255)'];
    const LIGHT = ['rgb(255,115,115)', 'rgb(115,157,255)'];
    const TREE = 'rgb(0,160,0)';

    let sim = null;
    let running = false;
    let rafId = null;
    let frameCount = 0;

    // ---- Build the parameter form ----
    const form = $('mm-params');
    let group = null, grid = null;
    for (const d of PARAMS) {
      if (d.group !== group) {
        group = d.group;
        const details = document.createElement('details');
        if (form.children.length === 0) details.open = true;
        const summary = document.createElement('summary');
        summary.textContent = group;
        grid = document.createElement('div');
        grid.className = 'mm-fields';
        details.append(summary, grid);
        form.append(details);
      }
      const label = document.createElement('label');
      label.className = 'mm-field' + (typeof d.value === 'boolean' ? ' mm-check' : '');
      if (d.help) label.title = d.help;
      const span = document.createElement('span');
      span.textContent = d.label;
      const input = document.createElement('input');
      input.id = 'mm-p-' + d.key;
      if (typeof d.value === 'boolean') {
        input.type = 'checkbox';
        input.checked = d.value;
        label.append(input, span);
      } else {
        input.type = 'number';
        input.step = 'any';
        input.value = d.value;
        label.append(span, input);
      }
      grid.append(label);
    }
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'mm-link';
    resetBtn.textContent = 'Restore default settings';
    resetBtn.addEventListener('click', () => {
      for (const d of PARAMS) {
        const el = $('mm-p-' + d.key);
        if (typeof d.value === 'boolean') el.checked = d.value; else el.value = d.value;
      }
    });
    form.append(resetBtn);
    form.addEventListener('submit', (e) => { e.preventDefault(); startTrial(); });

    function readParams() {
      const p = {};
      for (const d of PARAMS) {
        const el = $('mm-p-' + d.key);
        p[d.key] = typeof d.value === 'boolean' ? el.checked : Number(el.value);
      }
      return p;
    }

    function showError(msg) {
      const box = $('mm-error');
      box.textContent = msg;
      box.hidden = !msg;
    }

    // ---- Run control ----
    function startTrial(replaySeed) {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      running = false;
      showError('');
      let p;
      try {
        p = readParams();
        validateParams(p);
        if (p.runSelfChecks) checkModelRules();
      } catch (e) {
        showError(e.message);
        updateButtons();
        return;
      }
      const seed = replaySeed !== undefined ? replaySeed
        : (p.useFixedSeed ? p.randomSeed : newRandomSeed());
      $('mm-p-randomSeed').value = seed;
      try {
        sim = createSimulation(p, seed);
      } catch (e) {
        showError(e.message);
        updateButtons();
        return;
      }
      console.log(`Trial seed: ${seed} (set useFixedSeed=true to replay it)`);
      if (p.showAnimation) {
        running = true;
        render();
        showResults();
        rafId = requestAnimationFrame(frame);
      } else {
        runToEnd(sim);
        render();
        showResults();
      }
      updateButtons();
    }

    function frame() {
      rafId = null;
      if (!running || !sim) return;
      const per = Math.max(1, Math.floor(Number($('mm-p-plotEvery').value) || 1));
      for (let i = 0; i < per && !sim.finished; i++) {
        const r = stepSimulation(sim);
        if (r.behaviorChanged || r.emptyTreeDiscovered) break; // draw state changes promptly
      }
      render();
      if (++frameCount % 10 === 0) showResults(); // keep the live results reasonably fresh
      if (sim.finished) {
        running = false;
        showResults();
        updateButtons();
        return;
      }
      rafId = requestAnimationFrame(frame);
    }

    function togglePause() {
      if (!sim || sim.finished) return;
      running = !running;
      if (running) rafId = requestAnimationFrame(frame);
      else showResults();
      updateButtons();
    }

    function updateButtons() {
      const pause = $('mm-pause');
      pause.disabled = !sim || sim.finished;
      pause.textContent = running ? 'Pause' : 'Resume';
      $('mm-replay').disabled = !sim;
      for (const id of ['mm-dl-history', 'mm-dl-comm']) if ($(id)) $(id).disabled = !sim;
    }

    $('mm-run').addEventListener('click', () => startTrial());
    $('mm-replay').addEventListener('click', () => sim && startTrial(sim.seed));
    $('mm-pause').addEventListener('click', togglePause);

    // ---- Results ----
    function showResults() {
      if (!sim) return;
      const { rows, lines } = summarize(sim);
      const cols = Object.keys(rows[0]);
      const fmt = (v) => {
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (Number.isNaN(v)) return 'NaN';
        return Number.isInteger(v) ? String(v) : v.toFixed(2);
      };
      const table = document.createElement('table');
      const thead = table.createTHead().insertRow();
      for (const c of cols) {
        const th = document.createElement('th');
        th.textContent = c;
        thead.append(th);
      }
      const tbody = table.createTBody();
      for (const r of rows) {
        const tr = tbody.insertRow();
        for (const c of cols) tr.insertCell().textContent = fmt(r[c]);
      }
      const holder = $('mm-results');
      holder.replaceChildren(table);
      const status = sim.finished ? '' : (running ? '(running...)\n' : '(paused)\n');
      $('mm-summary').textContent = status + lines.join('\n');
    }

    function downloadCSV(name, header, rows) {
      const text = header + '\n' + rows.map((r) => r.join(',')).join('\n') + '\n';
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if ($('mm-dl-history')) $('mm-dl-history').addEventListener('click', () => sim && downloadCSV(
      `history_seed${sim.seed}.csv`, 'time,separation,x1,y1,x2,y2', sim.history));
    if ($('mm-dl-comm')) $('mm-dl-comm').addEventListener('click', () => sim && downloadCSV(
      `communication_seed${sim.seed}.csv`, 'time,separation,receiptProbability,attempted,received',
      sim.communicationLog));

    // ---- Drawing ----
    function niceStep(range) {
      const raw = range / 5;
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const n = raw / mag;
      return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
    }

    function render() {
      if (!sim) return;
      const p = sim.p;
      const W = p.forestWidth, H = p.forestHeight;
      const dpr = window.devicePixelRatio || 1;
      const ml = 48, mr = 12, mt = 10, mb = 42;
      const cssW = Math.max(240, canvas.clientWidth);
      let scale = (cssW - ml - mr) / W;
      const maxPlotH = Math.max(240, window.innerHeight * 0.78);
      if (H * scale > maxPlotH) scale = maxPlotH / H;
      const plotW = W * scale, plotH = H * scale;
      const cssH = plotH + mt + mb;
      if (canvas.style.height !== cssH + 'px') canvas.style.height = cssH + 'px';
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const X = (x) => ml + x * scale;
      const Y = (y) => mt + (H - y) * scale;

      // Axes and grid
      ctx.fillStyle = '#fff';
      ctx.fillRect(ml, mt, plotW, plotH);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#444';
      ctx.strokeStyle = '#e6e6e6';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      const sx = niceStep(W), sy = niceStep(H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let x = 0; x <= W + 1e-9; x += sx) {
        ctx.beginPath(); ctx.moveTo(X(x), mt); ctx.lineTo(X(x), mt + plotH); ctx.stroke();
        ctx.fillText(+x.toFixed(6), X(x), mt + plotH + 4);
      }
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let y = 0; y <= H + 1e-9; y += sy) {
        ctx.beginPath(); ctx.moveTo(ml, Y(y)); ctx.lineTo(ml + plotW, Y(y)); ctx.stroke();
        ctx.fillText(+y.toFixed(6), ml - 5, Y(y));
      }
      ctx.strokeStyle = '#999';
      ctx.strokeRect(ml, mt, plotW, plotH);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('x position', ml + plotW / 2, mt + plotH + 34);
      ctx.save();
      ctx.translate(13, mt + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('y position', 0, 0);
      ctx.restore();

      // Everything else is clipped to the forest, like MATLAB axis limits.
      ctx.save();
      ctx.beginPath();
      ctx.rect(ml, mt, plotW, plotH);
      ctx.clip();

      // Trees
      ctx.strokeStyle = TREE;
      ctx.lineWidth = 1;
      for (let j = 0; j < p.numberTrees; j++) {
        const x = X(sim.treeX[j]), y = Y(sim.treeY[j]);
        ctx.beginPath();
        ctx.moveTo(x, y - 4); ctx.lineTo(x + 3.6, y + 2.6); ctx.lineTo(x - 3.6, y + 2.6);
        ctx.closePath();
        ctx.stroke();
      }

      // Contact line
      const inContact = sim.partnerDistance <= p.communicationRange;
      ctx.strokeStyle = inContact ? 'rgb(64,153,64)' : 'rgb(153,153,153)';
      ctx.beginPath();
      ctx.moveTo(X(sim.monkeys[0][0]), Y(sim.monkeys[0][1]));
      ctx.lineTo(X(sim.monkeys[1][0]), Y(sim.monkeys[1][1]));
      ctx.stroke();

      for (let m = 0; m < 2; m++) {
        const [mx, my] = sim.monkeys[m];
        // Tree-attraction radius (dashed) and communication radius (dotted)
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = COLORS[m];
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.arc(X(mx), Y(my), p.treeAttractionRadius * scale, 0, 2 * Math.PI); ctx.stroke();
        ctx.strokeStyle = LIGHT[m];
        ctx.setLineDash([1.5, 3]);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(X(mx), Y(my), p.communicationRange * scale, 0, 2 * Math.PI); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineCap = 'butt';

        // Trail
        ctx.strokeStyle = COLORS[m];
        ctx.lineWidth = 1;
        ctx.beginPath();
        const h = sim.history;
        const ix = 2 + 2 * m;
        ctx.moveTo(X(h[0][ix]), Y(h[0][ix + 1]));
        for (let k = 1; k < h.length; k++) ctx.lineTo(X(h[k][ix]), Y(h[k][ix + 1]));
        ctx.stroke();

        // Trees this monkey knows have food
        ctx.lineWidth = 1.3;
        const know = sim.treeKnowledge[m];
        for (let j = 0; j < p.numberTrees; j++) {
          if (know[j] === 1) asterisk(X(sim.treeX[j]), Y(sim.treeY[j]), 6);
        }
      }

      // Checked empty trees (observer knowledge only; does not transmit facts)
      const empties = [];
      for (let j = 0; j < p.numberTrees; j++) {
        if (sim.treeKnowledge[0][j] === 0 || sim.treeKnowledge[1][j] === 0) empties.push(j);
      }
      ctx.lineCap = 'round';
      for (const [color, width] of [['#fff', 6], ['#000', 3]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        for (const j of empties) cross(X(sim.treeX[j]), Y(sim.treeY[j]), 5.5);
      }
      ctx.lineCap = 'butt';

      // Monkeys on top
      for (let m = 0; m < 2; m++) {
        ctx.fillStyle = COLORS[m];
        ctx.strokeStyle = COLORS[m];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(X(sim.monkeys[m][0]), Y(sim.monkeys[m][1]), 4.5, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.restore();

      // Title
      const displayState = [0, 1].map((m) =>
        sim.state[m] === 'search' && sim.roamTimeLeft[m] > EPS ? 'roam' : sim.state[m]);
      const fed = sim.hasEaten.filter(Boolean).length;
      const pNow = informationProbability(sim.partnerDistance, p.communicationRange,
        p.communicationMinSuccess, p.communicationFalloffPower);
      $('mm-title').innerHTML = '';
      const l1 = document.createElement('div');
      l1.textContent = `t=${sim.elapsedTime.toFixed(1)} | M1: ${displayState[0]} | M2: ${displayState[1]} | Fed: ${fed}/2`;
      const l2 = document.createElement('div');
      l2.textContent = `Separation: ${sim.partnerDistance.toFixed(1)} | ${inContact ? 'in contact' : 'out of contact'} | receipt chance: ${Math.round(100 * pNow)}%`;
      $('mm-title').append(l1, l2);
    }

    function asterisk(x, y, r) {
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 4;
        ctx.moveTo(x - r * Math.cos(a), y - r * Math.sin(a));
        ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
      ctx.stroke();
    }

    function cross(x, y, r) {
      ctx.beginPath();
      ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
      ctx.moveTo(x - r, y + r); ctx.lineTo(x + r, y - r);
      ctx.stroke();
    }

    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => render()).observe(canvas);
    else window.addEventListener('resize', render);

    updateButtons();
    startTrial(); // Like running the MATLAB script: start a trial on page load.
  }
})(typeof window !== 'undefined' ? window : globalThis);
