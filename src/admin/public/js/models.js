function modelsPage() {
  return {
    models: [],
    loading: true,

    async fetchModels() {
      this.loading = true;
      try {
        const res = await apiFetch(`${API_BASE}/models`);
        if (res.ok) {
          const data = await res.json();
          this.models = data.data || [];
        }
      } catch { /* ignore */ }
      this.loading = false;
    },
  };
}
