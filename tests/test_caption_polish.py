from server.caption_polish import validate_window


def test_validate_window_accepts_ordered_ranges():
    cues = ['hello', 'world', 'again']
    items = [
        {'start': 0, 'end': 2, 'original': 'Hello world.', 'translation': 'Xin chào thế giới.'},
        {'start': 2, 'end': 3, 'original': 'Again.', 'translation': 'Lại nữa.'},
    ]
    assert validate_window(cues, items) == items


def test_validate_window_rejects_invalid_ranges_and_empty_text():
    cues = ['hello', 'world']
    assert validate_window(cues, [{'start': 0, 'end': 3, 'original': 'bad', 'translation': 'sai'}]) is None
    assert validate_window(cues, [{'start': 0, 'end': 1, 'original': '', 'translation': 'trống'}]) is None
    assert validate_window(cues, [
        {'start': 0, 'end': 2, 'original': 'One.', 'translation': 'Một.'},
        {'start': 1, 'end': 2, 'original': 'Two.', 'translation': 'Hai.'},
    ]) is None
