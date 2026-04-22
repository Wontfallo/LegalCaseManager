"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useSemanticSearch } from "@/hooks/useApi";
import type { CaseDetailResponse } from "@/types";
import { formatDate } from "@/lib/utils";
import {
  Box,
  Grid,
  Paper,
  Typography,
  TextField,
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  Divider,
} from "@mui/material";

interface Props {
  caseDetail: CaseDetailResponse;
}

export default function CaseOverviewTab({ caseDetail }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchMutation = useSemanticSearch();

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error("Enter something to search for.");
      return;
    }

    try {
      await searchMutation.mutateAsync({
        query: searchQuery.trim(),
        case_id: caseDetail.id,
        top_k: 8,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Semantic search failed.");
    }
  };

  return (
    <Box sx={{ p: 4, maxWidth: 1200, mx: 'auto' }}>
      <Grid container spacing={4}>
        {/* Case Information */}
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Paper sx={{ p: 3, height: '100%' }} elevation={3}>
            <Typography variant="overline" color="primary" sx={{ fontWeight: 'bold' }}>
              Case Details
            </Typography>
            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', textTransform: 'uppercase' }}>
                  Title
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                  {caseDetail.title}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', textTransform: 'uppercase' }}>
                  Status
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
                  <Chip
                    size="small"
                    color="success"
                    label={caseDetail.status.replaceAll("_", " ")}
                    sx={{ fontWeight: 'bold', textTransform: 'uppercase' }}
                  />
                </Box>
              </Box>
              {caseDetail.filing_date && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', textTransform: 'uppercase' }}>
                    Filing Date
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                    {formatDate(caseDetail.filing_date)}
                  </Typography>
                </Box>
              )}
            </Box>
          </Paper>
        </Grid>

        {/* Client Information */}
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Paper sx={{ p: 3, height: '100%' }} elevation={3}>
            <Typography variant="overline" color="primary" sx={{ fontWeight: 'bold' }}>
              Client
            </Typography>
            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', textTransform: 'uppercase' }}>
                  Name
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                  {caseDetail.client.name}
                </Typography>
              </Box>
              {caseDetail.client.contact_info && (caseDetail.client.contact_info as Record<string, string>)?.email && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', textTransform: 'uppercase' }}>
                    Email
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                    {(caseDetail.client.contact_info as Record<string, string>).email}
                  </Typography>
                </Box>
              )}
            </Box>
          </Paper>
        </Grid>

        {/* Statistics Cards */}
        <Grid size={{ xs: 12, lg: 4 }}>
            <Grid container spacing={2} sx={{ height: '100%' }}>
                <Grid size={{ xs: 12 }}>
                    <Paper sx={{ p: 3, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }} elevation={1}>
                        <Typography variant="h3" color="primary.main" sx={{ fontWeight: '900' }}>
                            {caseDetail.document_count}
                        </Typography>
                        <Typography variant="overline" color="primary.light" sx={{ fontWeight: 'bold' }}>
                            Documents Ingested
                        </Typography>
                    </Paper>
                </Grid>
            </Grid>
        </Grid>

        {/* Semantic Search Panel */}
        <Grid size={{ xs: 12 }}>
          <Paper sx={{ p: 4, mt: 2 }} elevation={4}>
            <Typography variant="h5" gutterBottom sx={{ fontWeight: 'bold' }}>
              Semantic AI Search
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Query across your case data using natural language meaning.
            </Typography>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                fullWidth
                variant="outlined"
                placeholder="Search case meaning..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
              />
              <Button
                variant="contained"
                color="primary"
                onClick={handleSearch}
                disabled={searchMutation.isPending}
                sx={{ px: 4 }}
              >
                {searchMutation.isPending ? "Searching..." : "Search"}
              </Button>
            </Box>

            {searchMutation.data && (
              <Box sx={{ mt: 4 }}>
                {searchMutation.data.length === 0 ? (
                  <Typography color="text.secondary">No matching indexed content found.</Typography>
                ) : (
                  <List component={Box} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {searchMutation.data.map((result, index) => (
                      <Paper key={`${result.source_id}-${index}`} variant="outlined" sx={{ p: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', textTransform: 'uppercase' }}>
                            {result.source_type}
                          </Typography>
                          <Typography variant="caption" color="primary">
                            Match {(result.similarity_score * 100).toFixed(0)}%
                          </Typography>
                        </Box>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                          {result.text_chunk}
                        </Typography>
                      </Paper>
                    ))}
                  </List>
                )}
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
