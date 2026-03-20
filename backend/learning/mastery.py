from dataclasses import dataclass

@dataclass
class AnswerEvent:
    topic_id: str
    correct: bool
    difficulty: float  # 0.5 easy, 1.0 medium, 1.5 hard


def update_mastery(current: float, event: AnswerEvent) -> float:
    """
    current: mastery in [0, 1]
    Returns updated mastery in [0, 1]
    """
    lr = 0.08 * event.difficulty

    if event.correct:
        new = current + lr * (1.0 - current)
    else:
        new = current - (lr * 0.9) * (current + 0.15)

    return max(0.0, min(1.0, new))
