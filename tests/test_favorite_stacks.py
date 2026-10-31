"""Favorite stacks use cached image features; no originals, AI, or real library."""
import numpy as np
from support import DatabaseCase


class FavoriteStacksTests(DatabaseCase):
    def photo(self, name, angle=0, **fields):
        vector = np.array([np.cos(angle), np.sin(angle)], dtype=np.float32)
        return self.seed(self.case / name, media_type='image', favorite=1,
                         embedding=vector.tobytes(), **fields)

    def listing(self, **params):
        response = self.client.get('/api/library/', query_string={
            'favorite': 'true', 'stack_type': 'near', 'sort': 'file_name', 'order': 'asc', **params})
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def test_stacks_are_built_before_pagination_and_keep_every_matching_file(self):
        ids = [self.photo(name) for name in ('A.jpg', 'B.jpg', 'C.jpg')]
        lone = self.photo('D.jpg', np.pi / 2)
        first = self.listing(per_page=1)
        self.assertEqual(first['pagination']['total'], 4)
        self.assertEqual(first['pagination']['display_total'], 2)
        self.assertEqual(first['pagination']['pages'], 2)
        self.assertEqual(first['data'][0]['id'], ids[0])
        self.assertEqual([m['id'] for m in first['data'][0]['stack_items']], ids)
        self.assertNotIn('embedding', str(first))
        second = self.listing(per_page=1, page=2)
        self.assertEqual([m['id'] for m in second['data']], [lone])
        selected = self.listing(fields='id')
        self.assertEqual(set(selected['data']), set(ids + [lone]))

    def test_only_matching_favorite_photos_stack_and_missing_features_stay_visible(self):
        a = self.photo('A.jpg', rating=5)
        b = self.photo('B.jpg', rating=5)
        self.photo('C.jpg', rating=1)
        self.seed(self.case / 'not-favorite.jpg', media_type='image', favorite=0,
                  embedding=np.array([1., 0.], dtype=np.float32).tobytes())
        video = self.seed(self.case / 'clip.mp4', favorite=1,
                          embedding=np.array([1., 0.], dtype=np.float32).tobytes(), rating=5)
        missing = self.seed(self.case / 'missing.jpg', media_type='image', favorite=1, rating=5)
        corrupt = self.seed(self.case / 'invalid.jpg', media_type='image', favorite=1, rating=5,
                            embedding=b'bad')
        result = self.listing(rating=5)
        self.assertEqual(result['pagination']['total'], 5)
        self.assertEqual({m['id'] for m in result['data']}, {a, video, missing, corrupt})
        self.assertEqual([m['id'] for m in result['data'][0]['stack_items']], [a, b])

    def test_near_and_similar_have_existing_thresholds_and_honor_exclusions(self):
        a, b = self.photo('A.jpg'), self.photo('B.jpg', .35)  # cosine .939
        self.assertEqual(len(self.listing()['data']), 2)
        result = self.listing(stack_type='similar')
        self.assertEqual(len(result['data']), 1)
        self.db.execute('INSERT INTO dup_exclusions(media_id_a,media_id_b,dup_type) VALUES (?,?,?)',
                        (a, b, 'similar'))
        self.db.commit()
        self.assertEqual(len(self.listing(stack_type='similar')['data']), 2)

    def test_cluster_uses_existing_hdbscan_and_exclusions(self):
        ids = [self.photo(f'{i}.jpg', angle) for i, angle in enumerate(
            [0, .001, .002, .003, 1.55, 1.551, 1.552, 1.553])]
        result = self.listing(stack_type='cluster')
        self.assertEqual(sorted(len(m.get('stack_items', [m])) for m in result['data']), [4, 4])
        self.db.execute('INSERT INTO dup_exclusions(media_id_a,media_id_b,dup_type) VALUES (?,?,?)',
                        (ids[0], ids[1], 'cluster'))
        self.db.commit()
        for row in self.listing(stack_type='cluster')['data']:
            members = {m['id'] for m in row.get('stack_items', [row])}
            self.assertFalse({ids[0], ids[1]} <= members)

    def test_off_nonfavorite_and_unknown_modes_do_not_hide_files_or_write_data(self):
        self.photo('A.jpg'); self.photo('B.jpg')
        before = self.db.total_changes
        for params in ({'stack_type': 'off'}, {'stack_type': 'wrong'}, {'favorite': ''}):
            result = self.listing(**params)
            self.assertEqual(len(result['data']), 2)
            self.assertTrue(all('stack_items' not in m for m in result['data']))
        self.assertEqual(self.db.total_changes, before)
