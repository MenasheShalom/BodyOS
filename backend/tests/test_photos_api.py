from tests.conftest import auth_for

TAKEN = "2026-02-28T07:00:00Z"


def _upload(client, headers, storage, pose: str = "front", taken_at: str = TAKEN):
    ticket = client.post("/photos/upload-url", headers=headers).json()
    storage.objects.add(ticket["path"])  # simulate the browser uploading to the signed URL
    res = client.post(
        "/photos",
        json={"photo_id": ticket["photo_id"], "taken_at": taken_at, "pose": pose},
        headers=headers,
    )
    return ticket, res


def test_upload_url_is_under_user_folder(client, headers, user, storage) -> None:
    ticket = client.post("/photos/upload-url", headers=headers).json()
    assert ticket["path"] == f"{user}/{ticket['photo_id']}.jpg"
    assert ticket["token"] == f"token-for-{ticket['path']}"


def test_register_requires_uploaded_object(client, headers, storage) -> None:
    ticket = client.post("/photos/upload-url", headers=headers).json()
    res = client.post(
        "/photos",
        json={"photo_id": ticket["photo_id"], "taken_at": TAKEN, "pose": "front"},
        headers=headers,
    )
    assert res.status_code == 400
    assert client.get("/photos", headers=headers).json() == []


def test_register_list_and_filter(client, headers, storage) -> None:
    _, res = _upload(client, headers, storage, "front")
    assert res.status_code == 201
    assert res.json()["url"].startswith("https://storage.test/")
    _upload(client, headers, storage, "side", "2026-02-27T07:00:00Z")
    assert len(client.get("/photos", headers=headers).json()) == 2
    fronts = client.get("/photos", params={"pose": "front"}, headers=headers).json()
    assert [p["pose"] for p in fronts] == ["front"]


def test_register_twice_is_409(client, headers, storage) -> None:
    ticket, _ = _upload(client, headers, storage)
    res = client.post(
        "/photos",
        json={"photo_id": ticket["photo_id"], "taken_at": TAKEN, "pose": "front"},
        headers=headers,
    )
    assert res.status_code == 409


def test_delete_removes_object_and_row(client, headers, storage) -> None:
    ticket, res = _upload(client, headers, storage)
    photo_id = res.json()["id"]
    assert client.delete(f"/photos/{photo_id}", headers=headers).status_code == 204
    assert ticket["path"] in storage.deleted
    assert client.get("/photos", headers=headers).json() == []


def test_other_user_cannot_claim_or_delete(client, headers, storage, make_user) -> None:
    ticket, res = _upload(client, headers, storage)
    other = auth_for(make_user())
    # Other user tries to register the same photo id: their path differs, so nothing is found.
    claim = client.post(
        "/photos",
        json={"photo_id": ticket["photo_id"], "taken_at": TAKEN, "pose": "front"},
        headers=other,
    )
    assert claim.status_code == 400
    assert client.delete(f"/photos/{res.json()['id']}", headers=other).status_code == 404
    assert client.get("/photos", headers=other).json() == []
    assert storage.deleted == []
