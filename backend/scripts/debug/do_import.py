import json
import urllib.request
import urllib.error
from import_fill_blanks import extract_questions_from_doc, extract_answers_from_doc, DOCX_PATH, placeholder_re, API_BASE

questions = extract_questions_from_doc(DOCX_PATH)
answers = extract_answers_from_doc(DOCX_PATH)

login_data = json.dumps({
    "username": "teacher",
    "password": "meoo.local",
    "deviceInfo": "import-script",
}).encode("utf-8")
req = urllib.request.Request(
    f"{API_BASE}/auth/secure-login",
    data=login_data,
    headers={"Content-Type": "application/json"},
    method="POST",
)
resp = urllib.request.urlopen(req)
body = json.loads(resp.read().decode("utf-8"))
access_token = body["data"]["session"]["access_token"]
auth_header = f"Bearer {access_token}"
print("登录成功:", body["data"]["user"].get("real_name"))

start_num = 3
to_import = [q for q in questions if q["num"] >= start_num]
max_num = max(q["num"] for q in to_import)
print("导入第", start_num, "-", max_num, "题，共", len(to_import), "道")
print()

success = 0
failed = []
ph_order = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"

for q in to_import:
    num = q["num"]
    title = q["title"]
    ans_list = answers.get(num, [])
    unique_ph = sorted(
        set(placeholder_re.findall(q["blank_template"])),
        key=lambda c: ph_order.index(c) if c in ph_order else 999,
    )
    ph_count = len(unique_ph)

    while len(ans_list) < ph_count:
        ans_list.append([""])
    ans_list = ans_list[:ph_count]

    weight = round(10 / ph_count) if ph_count > 0 else 10
    weights = [weight] * ph_count
    if ph_count > 0:
        weights[-1] = 10 - sum(weights[:-1])

    task_data = {
        "title": f"第{num}题、{title}",
        "description": q["description"],
        "task_type": "fill_blank",
        "class_ids": [],
        "total_score": 10,
        "deadline": None,
        "allow_late_submission": False,
        "allow_run_code": True,
        "max_run_seconds": 3,
        "reference_code": "",
        "expected_output": "",
        "hint": "",
        "required_keywords": [],
        "blank_template": q["blank_template"],
        "blank_answers": ans_list,
        "blank_weights": weights,
    }

    data = json.dumps(task_data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}/python/teacher/tasks",
        data=data,
        headers={"Content-Type": "application/json", "Authorization": auth_header},
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read().decode("utf-8"))
        if result.get("data"):
            success += 1
            print("✓ 第", num, "题:", title)
        else:
            failed.append(num)
            print("✗ 第", num, "题:", title, "-", result.get("error"))
    except urllib.error.HTTPError as e:
        failed.append(num)
        err_body = e.read().decode("utf-8")
        print("✗ 第", num, "题:", title, "- HTTP", e.code, err_body[:100])

print()
print("=" * 50)
print("导入完成: 成功", success, "道，失败", len(failed), "道")
if failed:
    print("失败题目:", failed)
print("=" * 50)
