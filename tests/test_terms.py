import json

from server.terms import Glossary


def make(tmp_path, data):
    path = tmp_path / 'glossary.json'
    path.write_text(json.dumps(data), encoding='utf-8')
    glossary = Glossary(path)
    glossary.refresh()
    return glossary, path


def test_protect_keeps_names_translates_terms_and_restores(tmp_path):
    glossary, _ = make(tmp_path, {'keep': ['Amazon S3', 'Amazon S3 Glacier'],
                                  'translate': {'stakeholders': 'các bên liên quan'}})
    masked, restore = glossary.protect('Stakeholders use Amazon S3 Glacier and IAM.')
    assert masked == 'T1 use T0 and T2.'
    # Longest keep term wins, translated terms keep sentence-initial capitals, acronyms survive.
    assert restore('T1 dùng T0 và T2.') == 'Các bên liên quan dùng Amazon S3 Glacier và IAM.'


def test_restore_rejects_lost_or_duplicated_placeholders(tmp_path):
    glossary, _ = make(tmp_path, {'keep': ['Amazon S3']})
    _, restore = glossary.protect('Amazon S3 and AWS')
    assert restore('T0 và') is None
    assert restore('T0 T0 T1') is None


def test_placeholder_style_avoids_existing_t_number_tokens(tmp_path):
    glossary, _ = make(tmp_path, {'keep': ['Amazon EC2']})
    masked, restore = glossary.protect('Amazon EC2 T3 instances')
    assert masked.startswith('X0X') and 'T3' not in masked.replace('X1X', '')
    assert restore(masked) == 'Amazon EC2 T3 instances'


def test_glossary_reloads_when_file_changes(tmp_path):
    glossary, path = make(tmp_path, {'translate': {'workload': 'khối lượng công việc'}})
    before = glossary.digest
    path.write_text(json.dumps({'translate': {'workload': 'tải'}}), encoding='utf-8')
    glossary.mtime = None  # mtime granularity can hide a same-second rewrite
    glossary.refresh()
    assert glossary.digest != before and glossary.translate['workload'] == 'tải'


def test_speakable_reads_names_acronyms_and_symbols(tmp_path):
    glossary, _ = make(tmp_path, {'pronounce': {'Amazon': 'a ma dôn', 'Lambda': 'lam đa', 'Route 53': 'rao năm mươi ba'}})
    assert glossary.speakable('Amazon S3 và AWS Lambda') == 'a ma dôn ét ba và ây đáp liu ét lam đa'
    assert glossary.speakable('Dùng EC2 (IAM) & Amazon Route 53.') == 'Dùng i xi hai, ai ây em, và a ma dôn rao năm mươi ba.'
    # Vietnamese words and lowercase text are untouched.
    assert glossary.speakable('Mỗi khu vực có nhiều vùng.') == 'Mỗi khu vực có nhiều vùng.'


def test_postprocess_fixes_terms_only_when_source_matches_and_drops_invented_glosses(tmp_path):
    glossary, _ = make(tmp_path, {'fix': [
        {'when': 'Availability Zones?', 'replace': {'(?i)khu vực có sẵn': 'Vùng sẵn sàng'}},
        {'replace': {'\\bcậu\\b': 'bạn'}}]})
    assert glossary.postprocess('multiple Availability Zones', 'nhiều khu vực có sẵn') == 'nhiều Vùng sẵn sàng'
    assert glossary.postprocess('pick any spot', 'chọn khu vực có sẵn') == 'chọn khu vực có sẵn'
    assert glossary.postprocess('See you!', 'Hẹn gặp cậu!') == 'Hẹn gặp bạn!'
    assert glossary.postprocess('Use IAM (IAM) now', 'Dùng IAM (IAM-Mã định danh AWS) ngay') == 'Dùng IAM (IAM) ngay'


def test_bundled_glossary_is_valid():
    glossary = Glossary()
    glossary.refresh()
    assert glossary.keep and glossary.fixes and glossary.pronounce
    assert all(isinstance(v, str) and v for v in [*glossary.translate.values(), *glossary.pronounce.values()])
