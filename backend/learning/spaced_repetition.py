from dataclasses import dataclass
from datetime import datetime, timedelta

@dataclass
class SRSState:
    interval_days: int = 1
    ease: float = 2.3
    repetitions: int = 0
    due_at: datetime = datetime.utcnow()


def review(state: SRSState, quality: int) -> SRSState:
    """
    quality: 0..5 (0=blackout, 5=perfect)
    """
    now = datetime.utcnow()

    if quality < 3:
        state.repetitions = 0
        state.interval_days = 1
    else:
        state.repetitions += 1
        if state.repetitions == 1:
            state.interval_days = 1
        elif state.repetitions == 2:
            state.interval_days = 3
        else:
            state.interval_days = int(state.interval_days * state.ease)

    state.ease = max(1.3, state.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
    state.due_at = now + timedelta(days=state.interval_days)
    return state
