import {aiter_stream_lines} from "https://cdn.jsdelivr.net/npm/csv-iter-parse@0.1.3/src/aiter-utils.js"
import {imm, imm_set, imm_html, imm_raf} from 'https://cdn.jsdelivr.net/npm/imm-dom@0.3.7/esm/index.min.js'
import {create_uuid_trie} from './uuid-trie.js'

const fafsa_uuid_model = {
    history: new Map(),

    search(uuid_search) {
        let el_search_result = this.history.get(uuid_search)
        if (null == el_search_result) {
            let el_status = imm_html.td()
            el_search_result = imm_html.tr(
                {class: 'search-result'},
                imm_html.td(`${uuid_search}`),
                el_status)
            this.history.set(uuid_search, el_search_result)

            this._update_status(uuid_search, el_status)
        }

        window.search_result_tbody.prepend(el_search_result)
    },

    _detail_by_semantic: {
        potentially_affected: {
            label: 'potentially affected applications',
            render_match: el_status =>
                imm_set(el_status, {class:'search-result-potentially-affected'}, 'Potentially affected'),
            render_absent: el_status =>
                imm_set(el_status, {class:'search-result-unaffected'}, 'Unaffected'),
        },
        unaffected: {
            label: 'unaffected applications',
            render_match: el_status =>
                imm_set(el_status, {class:'search-result-unaffected'}, 'Unaffected'),
            render_absent: el_status =>
                imm_set(el_status, {class:'search-result-potentially-affected'}, 'Potentially affected'),
        },
        neutral: {
            label: 'unknown semantics',
            render_match: el_status =>
                imm_set(el_status, {class:'search-result-match'}, 'Present'),
            render_absent: el_status =>
                imm_set(el_status, {class:'search-result-nomatch'}, imm_html.b('Not'), ' present'),
        }
    },
    async _update_status(uuid_search, el_status) {
        for(; true; await imm_raf()) {
            let match_found = this.uuid_trie.lookup(uuid_search)

            if (match_found)
                return this._semantic.render_match(el_status)
            else if ('ready' == document.documentElement.dataset.status)
                return this._semantic.render_absent(el_status)
            else if (!el_status.className)
                imm_set(el_status, {class:'hint-caution'}, imm_html.i('(searching)'))
        }
    },

    clear() {
        this.history = new Map()
        imm_set(window.search_result_tbody)
    },

    refresh() {
        let prev_searches = this.history.keys()
        this.clear()

        for (let uuid of prev_searches)
            this.search(uuid)
    },

    evt_form(evt) {
        evt.preventDefault()
        let frm = new FormData(evt.target)
        return this.search(frm.get('uuid_search'))
    },

    evt_input(evt) {
        return this.search(evt.target.value)
    },

    async evt_load_csv_of_fafsa_uuids(file) {
        return await this.load_csv_of_fafsa_uuids(
            aiter_stream_lines( file.stream() ) )
    },

    async load_csv_of_fafsa_uuids(aiter_lines) {
        this.clear()
        let status_target = document.documentElement.dataset
        try {
            // Determine FAFSA UUID semantic from CSV header line
            let {value: ln_header} = await aiter_lines.next()
            console.log('CSV header: %o')
            this._determine_csv_semantic(ln_header)

            this.uuid_trie = window.uuid_trie = create_uuid_trie()

            let ts0 = new Date()
            status_target.status = 'loading'
            for await (let n of this._aiter_load_csv_of_uuids(aiter_lines))
                await this._load_progress_update(ts0, uuid_trie)
            await this._load_progress_update(ts0, uuid_trie)

            status_target.status = 'ready'
            return uuid_trie
        } catch (err) {
            status_target.status = 'error'
            throw err
        }
    },

    _determine_csv_semantic(ln_header) {
        if (ln_header.match(/^(FAFSA_UUID_POTENTIALLY_AFFECTED|FAFSA_UUID_AFFECTED)\b/i)) {
            this.semantic = 'potentially_affected'
            this._semantic = this._detail_by_semantic.potentially_affected
        } else if (ln_header.match(/^(FAFSA_UUID_UNAFFECTED|FAFSA_UUID)\b/i)) {
            this.semantic = 'unaffected'
            this._semantic = this._detail_by_semantic.unaffected
        } else {
            this.semantic = 'neutral'
            this._semantic = this._detail_by_semantic.neutral
        }
        window.progress_tgt.querySelector('[name=semantic]').textContent = `${this._semantic.label}`
        window.search_result_tbody.parentElement.classList.add('semantic-'+this.semantic)
        console.log('FAFSA UUID semantic: %o', this.semantic)
        return this.semantic
    },

    async _load_progress_update(ts0, uuid_trie) {
        let td = (Date.now() - ts0)/1000
        window.progress_tgt.querySelector('[name=uuid_count]').textContent = `${uuid_trie.n}`
        await imm_raf()
    },

    _n_report_batch: 5000,
    async * _aiter_load_csv_of_uuids(aiter_lines) {
        let n_batch = this._n_report_batch
        let n = n_batch ?? 5000
        let uuid_trie = this.uuid_trie
        for await (let ln of aiter_lines) {
            let uuid = ln.split(',')[0].replaceAll('"', '')
            uuid_trie.add_record({uuid})

            if (0 >= --n) {
                // yield to UI thread after a batch
                yield n = n_batch
            }
        }

        console.log('Done loading FAFSA UUIDs', uuid_trie.shared, {uuid_trie}, )
    }
}
window.fafsa_uuid_model = fafsa_uuid_model
